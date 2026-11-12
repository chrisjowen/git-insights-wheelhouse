/**
 * Git insights: a page in Wheelhouse's left-hand menu with the figures across
 * every project the plugin is on for, and each project's own insights (who is
 * working on it, its latest commits, the files that change most, open pull
 * requests and a few figures), from each clone's git history and, when its
 * `origin` is on GitHub, from GitHub through `gh`.
 *
 * Reading is slow next to a page view, so the plugin keeps one snapshot per
 * project and reads a project again only once its snapshot is older than the
 * refresh interval (60 minutes by default). Wheelhouse asks the provider at
 * most once a minute and serves its last answer while it asks, so a page
 * never waits for a re-read it has already seen. Projects due a read are read
 * a few at a time while the call has time left; the rest are read on the next
 * ask. A failed re-read keeps the last snapshot, says so, and is tried again a
 * few minutes later. It writes nothing.
 *
 * @typedef {import('./types.js').Snapshot} Snapshot
 */

import { CollectError, PERIODS, collect, ignoreMatcher } from './collect.js';
import { overview } from './overview.js';

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
/** A failed read is tried again after this long, not on every ask. */
const RETRY_MS = 5 * 60_000;
/** Wheelhouse gives a provider call at most 10 s; reading leaves room to answer. */
const TIMEOUT_MS = 10_000;
const READ_BUDGET_MS = 9_000;
/** A read is started only with at least this long left in the call. */
const MIN_READ_MS = 3_000;
/** Projects read at the same time. */
const CONCURRENCY = 4;

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
 * The plugin, with its own snapshot store. `now` dates the snapshots and
 * `clock` measures the call's time left; both are for tests.
 *
 * @param {{ now?: () => number; clock?: () => number }} [o]
 */
export function createPlugin({ now = Date.now, clock = Date.now } = {}) {
	/** @type {Map<string, { key: string; snapshot: Snapshot | null; failed: { at: number; reason: string } | null }>} */
	const store = new Map();

	/** Whether a kept entry still answers at `at`, without reading again. */
	const current = (entry, settings, at) => {
		if (entry.failed && at - entry.failed.at < RETRY_MS) return true;
		return !!entry.snapshot && at - entry.snapshot.collectedAt < settings.refreshMinutes * 60_000;
	};

	/** Read one project again, keeping what it had when that fails. */
	async function read(project, ctx, settings, key, kept, budgetMs) {
		const at = now();
		let snapshot;
		try {
			snapshot = await collect((r) => ctx.exec({ ...r, project: project.id }), {
				now: at,
				ignore: ignoreMatcher(settings.hotspotIgnore),
				includeBots: settings.includeBots,
				budgetMs
			});
		} catch (e) {
			const reason =
				e instanceof CollectError ? e.message : 'The project’s history couldn’t be read.';
			const entry = { key, snapshot: kept?.snapshot ?? null, failed: { at, reason } };
			store.set(project.id, entry);
			return entry;
		}

		// GitHub failing this time keeps what it said last time, marked as older.
		const before = kept?.snapshot;
		if (snapshot.github.state === 'failed' && before && before.githubAt) {
			const last = before.github;
			if (last.state === 'ok' || last.state === 'stale') {
				snapshot.github = { ...last, state: 'stale', reason: snapshot.github.reason };
				snapshot.githubAt = before.githubAt;
			}
		}
		const entry = { key, snapshot, failed: null };
		store.set(project.id, entry);
		return entry;
	}

	async function fetch(ctx) {
		const projects = Array.isArray(ctx.projects) ? ctx.projects : [];
		if (!projects.length) {
			return { available: false, reason: 'Git insights isn’t on for any project yet.' };
		}
		const settings = readSettings(ctx.settings);
		// Settings that change what is read start new snapshots; the others only change how they show.
		const key = JSON.stringify([settings.hotspotIgnore, settings.includeBots]);
		const started = clock();
		const at = now();

		/** @type {Map<string, { snapshot: Snapshot | null; failed: { at: number; reason: string } | null }>} */
		const answers = new Map();
		const due = [];
		for (const project of projects) {
			const kept = store.get(project.id);
			const entry = kept?.key === key ? kept : null;
			if (entry && current(entry, settings, at)) answers.set(project.id, entry);
			else due.push({ project, entry });
		}

		let next = 0;
		const worker = async () => {
			while (next < due.length) {
				const left = READ_BUDGET_MS - (clock() - started);
				if (left < MIN_READ_MS || ctx.signal?.aborted) return;
				const { project, entry } = due[next++];
				answers.set(project.id, await read(project, ctx, settings, key, entry, left));
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
		// Out of time: a project not read again keeps what it had; one never read waits for the next ask.
		for (const { project, entry } of due) {
			if (!answers.has(project.id) && entry) answers.set(project.id, entry);
		}

		// A project the plugin is no longer on for is forgotten; it is read afresh if it comes back.
		const ids = new Set(projects.map((p) => p.id));
		for (const id of store.keys()) if (!ids.has(id)) store.delete(id);

		const value = overview(projects, answers, settings);
		const anyGitHub = value.projects.some((p) => p.state === 'ok' && p.repo);
		return {
			available: true,
			value,
			source: anyGitHub ? 'the git history and GitHub' : 'the git history',
			observedAt: value.oldestAt === null ? null : new Date(value.oldestAt).toISOString()
		};
	}

	return {
		providers: [
			{
				id: 'insights',
				scope: 'fleet',
				// Wheelhouse asks at most once a minute; each snapshot decides when to read again.
				ttlMs: 60_000,
				timeoutMs: TIMEOUT_MS,
				fetch
			}
		],
		contributions: [
			{
				slot: 'nav.page',
				id: 'insights',
				title: 'Git insights',
				provider: 'insights',
				render: { element: 'git-insights-page' }
			}
		]
	};
}

export default createPlugin();
