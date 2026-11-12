/**
 * The Git insights page's figures: each project's own, the totals across
 * every project the plugin is on for, and the whole page's value, kept small
 * enough for Wheelhouse to hand to the page.
 *
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').ProjectView} ProjectView
 * @typedef {import('./types.js').Overview} Overview
 */

import { PERIODS } from './collect.js';

/** Wheelhouse refuses a value over 256 KiB; this leaves room for the rest of the entry. */
export const VALUE_BUDGET = 240 * 1024;

const DAY = 86_400_000;

/** What GitHub said, when it said anything (now, or last time). */
const githubOf = (s) => (s.github.state === 'ok' || s.github.state === 'stale' ? s.github : null);

/**
 * One project's figures for each period, as its row on the page shows them.
 *
 * @param {Snapshot} s
 */
export function projectFigures(s) {
	const gh = githubOf(s);
	/** @type {Record<string, { commits: number; authors: number; merged: number | null }>} */
	const periods = {};
	for (const d of PERIODS) {
		const p = s.periods[d];
		periods[d] = {
			commits: p.commits,
			authors: p.authors,
			merged: gh ? (gh.periods[d]?.merged ?? 0) : null
		};
	}
	return { periods, github: s.github.state, openPrCount: gh ? gh.openPrCount : null };
}

/**
 * The totals across projects for each period. People who commit to several
 * projects count once, by name; past the people each project lists (its
 * busiest 15), the rest of a project's committers count as people of their own.
 *
 * @param {Snapshot[]} snapshots
 */
export function aggregate(snapshots) {
	/** @type {Overview['totals']} */
	const totals = {};
	const newestAt = Math.max(...snapshots.map((s) => s.collectedAt));
	for (const days of PERIODS) {
		const names = new Set();
		let unlisted = 0;
		let commits = 0;
		let active = 0;
		let add = 0;
		let del = 0;
		let filesChanged = 0;
		const weekly = days > 31;
		const counts = new Array(weekly ? Math.ceil(days / 7) : days).fill(0);
		const width = weekly ? 7 * DAY : DAY;
		/** @type {Overview['totals'][string]['github']} */
		let github = null;

		for (const s of snapshots) {
			const p = s.periods[days];
			commits += p.commits;
			if (p.commits) active += 1;
			add += p.add;
			del += p.del;
			filesChanged += p.filesChanged;
			for (const person of p.people) names.add(person.name);
			unlisted += Math.max(0, p.authors - p.people.length);
			// Each project's buckets end when it was read, so older reads move back to line up with the newest.
			const shift = Math.round((newestAt - s.collectedAt) / width);
			p.cadence.counts.forEach((n, i) => {
				const at = i - shift;
				if (at >= 0 && at < counts.length) counts[at] += n;
			});

			const gh = githubOf(s);
			if (!gh) continue;
			const g = gh.periods[days];
			github ??= {
				projects: 0,
				openPrCount: 0,
				merged: 0,
				openIssues: null,
				issuesOpened: null,
				issuesClosed: null
			};
			github.projects += 1;
			github.openPrCount += gh.openPrCount;
			github.merged += g?.merged ?? 0;
			if (gh.openIssues !== null) github.openIssues = (github.openIssues ?? 0) + gh.openIssues;
			if (g && g.issuesOpened !== null) {
				github.issuesOpened = (github.issuesOpened ?? 0) + g.issuesOpened;
			}
			if (g && g.issuesClosed !== null) {
				github.issuesClosed = (github.issuesClosed ?? 0) + g.issuesClosed;
			}
		}

		totals[days] = {
			days,
			projects: snapshots.length,
			active,
			commits,
			people: names.size + unlisted,
			add,
			del,
			filesChanged,
			cadence: { unit: weekly ? 'week' : 'day', counts },
			github
		};
	}
	return totals;
}

/** A project's detail without the lists that open in place, for when the page is too big. */
function slim(detail) {
	const periods = {};
	for (const [d, p] of Object.entries(detail.periods)) {
		periods[d] = {
			...p,
			people: p.people.map((x) => ({ ...x, recent: [] })),
			hotspots: p.hotspots.map((x) => ({ ...x, recent: [] }))
		};
	}
	return { ...detail, periods, commits: detail.commits.map((c) => ({ ...c, files: [] })) };
}

const size = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * Keep the page's value within `budget`: the largest projects' detail first
 * loses what opens in place, then, if that is not enough, is left out (the
 * project's row and the totals stay).
 *
 * @param {Overview} value
 */
export function fit(value, budget = VALUE_BUDGET) {
	let total = size(value);
	if (total <= budget) return value;
	const withDetail = () =>
		value.projects
			.filter((p) => p.state === 'ok' && p.detail)
			.map((p) => ({ p, bytes: size(p.detail) }))
			.sort((a, b) => b.bytes - a.bytes);

	for (const { p, bytes } of withDetail()) {
		if (total <= budget) return value;
		if (p.trimmed) continue;
		p.detail = slim(p.detail);
		p.trimmed = 'some';
		total -= bytes - size(p.detail);
	}
	for (const { p, bytes } of withDetail()) {
		if (total <= budget) return value;
		p.detail = null;
		p.trimmed = 'all';
		total -= bytes - 4;
	}
	return value;
}

/**
 * The page's value: each project as it was last read (or why it wasn't), the
 * totals across those read, and how the figures are kept.
 *
 * @param {{ id: string; name: string }[]} projects in the order Wheelhouse lists them
 * @param {Map<string, { snapshot: Snapshot | null; failed: { at: number; reason: string } | null }>} read
 * @param {{ refreshMinutes: number; defaultDays: number }} settings
 * @returns {Overview}
 */
export function overview(projects, read, settings) {
	/** @type {ProjectView[]} */
	const views = projects.map((project) => {
		const base = { id: project.id, name: project.name || project.id };
		const entry = read.get(project.id);
		if (!entry) return { ...base, state: 'pending' };
		if (!entry.snapshot) return { ...base, state: 'failed', reason: entry.failed?.reason ?? '' };
		const s = entry.snapshot;
		return {
			...base,
			state: 'ok',
			repo: s.repo,
			collectedAt: s.collectedAt,
			lastCommitAt: s.lastCommitAt,
			...projectFigures(s),
			detail: { ...s, refresh: entry.failed },
			trimmed: null
		};
	});
	const snapshots = projects.map((p) => read.get(p.id)?.snapshot).filter(Boolean);
	return fit({
		schema: 'git-insights-overview.v1',
		refreshMinutes: settings.refreshMinutes,
		defaultDays: settings.defaultDays,
		oldestAt: snapshots.length ? Math.min(...snapshots.map((s) => s.collectedAt)) : null,
		totals: aggregate(snapshots),
		projects: views
	});
}
