/**
 * Git insights: a project tab with who is working on the project, its latest
 * commits, the files that change most, open pull requests and a few figures
 * (commit cadence, time to merge, issues, releases), from the project clone's
 * git history and, when its `origin` is on GitHub, from GitHub through `gh`.
 *
 * Reading is slow next to a page view, so the plugin keeps one snapshot per
 * project and reads again only once it is older than the refresh interval
 * (60 minutes by default). Wheelhouse asks the provider at most once a minute
 * and serves its last answer while it asks, so a page never waits for a
 * re-read it has already seen. A failed re-read keeps the last snapshot, says
 * so, and is tried again a few minutes later. It writes nothing.
 *
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').TabData} TabData
 */

import { CollectError, PERIODS, collect, ignoreMatcher } from './collect.js';

export const DEFAULT_IGNORE = [
	'package-lock.json',
	'npm-shrinkwrap.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lockb',
	'Cargo.lock',
	'go.sum',
	'poetry.lock',
	'uv.lock',
	'Gemfile.lock',
	'composer.lock',
	'mix.lock',
	'Podfile.lock'
];
const DEFAULT_REFRESH_MINUTES = 60;
/** A failed re-read is tried again after this long, not on every ask. */
const RETRY_MS = 5 * 60_000;
/** Wheelhouse gives a provider call at most 10 s; reading leaves room to answer. */
const TIMEOUT_MS = 10_000;
const READ_BUDGET_MS = 9_000;

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The plugin's settings, each falling back to its default when missing or of the wrong kind. */
export function readSettings(settings) {
	const s = isRecord(settings) ? settings : {};
	const minutes = Number(s.refreshMinutes);
	const days = Number(s.defaultDays);
	return {
		refreshMinutes:
			Number.isFinite(minutes) && minutes > 0
				? Math.min(1440, Math.max(5, Math.round(minutes)))
				: DEFAULT_REFRESH_MINUTES,
		defaultDays: PERIODS.includes(days) ? days : 30,
		hotspotIgnore:
			Array.isArray(s.hotspotIgnore) && s.hotspotIgnore.every((p) => typeof p === 'string')
				? s.hotspotIgnore
				: DEFAULT_IGNORE,
		includeBots: typeof s.includeBots === 'boolean' ? s.includeBots : true
	};
}

/**
 * The plugin, with its own snapshot store. `now` is for tests.
 *
 * @param {{ now?: () => number }} [o]
 */
export function createPlugin({ now = Date.now } = {}) {
	/** @type {Map<string, { key: string; snapshot: Snapshot | null; failed: { at: number; reason: string } | null }>} */
	const store = new Map();

	/** A shown snapshot, as Wheelhouse's `Available` result. */
	const show = (snapshot, settings, failed) => ({
		available: true,
		value: {
			...snapshot,
			refreshMinutes: settings.refreshMinutes,
			defaultDays: settings.defaultDays,
			refresh: failed
		},
		source: snapshot.repo ? 'the git history and GitHub' : 'the git history',
		observedAt: new Date(snapshot.collectedAt).toISOString()
	});

	async function fetch(ctx) {
		const project = ctx.project;
		if (!project) return { available: false, reason: 'There is no project to read.' };
		const settings = readSettings(ctx.settings);
		// Settings that change what is read start a new snapshot; the others only change how it shows.
		const key = JSON.stringify([settings.hotspotIgnore, settings.includeBots]);
		const at = now();
		const kept = store.get(project.id);
		const entry = kept?.key === key ? kept : null;

		if (entry?.snapshot) {
			const age = at - entry.snapshot.collectedAt;
			const waiting = entry.failed && at - entry.failed.at < RETRY_MS;
			if (age < settings.refreshMinutes * 60_000 || waiting) {
				return show(entry.snapshot, settings, entry.failed);
			}
		}

		let snapshot;
		try {
			snapshot = await collect(ctx.exec, {
				now: at,
				ignore: ignoreMatcher(settings.hotspotIgnore),
				includeBots: settings.includeBots,
				budgetMs: READ_BUDGET_MS
			});
		} catch (e) {
			const reason =
				e instanceof CollectError ? e.message : 'The project’s history couldn’t be read.';
			if (entry?.snapshot) {
				entry.failed = { at, reason };
				return show(entry.snapshot, settings, entry.failed);
			}
			return { available: false, reason };
		}

		// GitHub failing this time keeps what it said last time, marked as older.
		const before = entry?.snapshot;
		if (snapshot.github.state === 'failed' && before && before.githubAt) {
			const last = before.github;
			if (last.state === 'ok' || last.state === 'stale') {
				snapshot.github = { ...last, state: 'stale', reason: snapshot.github.reason };
				snapshot.githubAt = before.githubAt;
			}
		}
		store.set(project.id, { key, snapshot, failed: null });
		return show(snapshot, settings, null);
	}

	return {
		providers: [
			{
				id: 'insights',
				scope: 'project',
				// Wheelhouse asks at most once a minute; the snapshot decides when to read again.
				ttlMs: 60_000,
				timeoutMs: TIMEOUT_MS,
				fetch
			}
		],
		contributions: [
			{
				slot: 'project.tab',
				id: 'insights',
				title: 'Insights',
				provider: 'insights',
				render: { element: 'git-insights-tab' }
			}
		]
	};
}

export default createPlugin();
