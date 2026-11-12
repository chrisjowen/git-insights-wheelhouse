/**
 * The shapes the plugin passes around, for editors only (JSDoc; nothing runs here).
 *
 * @typedef {(req: { argv: string[]; cwd: 'project' | 'task' | 'home'; timeoutMs: number; maxBytes: number }) =>
 *   Promise<{ ok: true; stdout: string } | { ok: false; reason: string; stdout: string; stderr: string }>} Exec
 *
 * @typedef {{ subject: string; at: number; url: string | null }} RecentCommit
 *
 * @typedef {{ name: string; bot: boolean; commits: number; add: number; del: number; lastAt: number;
 *   areas: string[]; spark: number[]; recent: RecentCommit[] }} Person
 *
 * @typedef {{ file: string; changes: number; add: number; del: number; lastAt: number; people: string[];
 *   recent: { subject: string; who: string; at: number }[] }} Hotspot
 *
 * @typedef {{ days: number; commits: number; authors: number; add: number; del: number; filesChanged: number;
 *   cadence: { unit: 'day' | 'week'; counts: number[] }; busiestDay: { name: string; share: number } | null;
 *   people: Person[]; hotspots: Hotspot[]; newPeople: string[] }} Period
 *
 * @typedef {{ subject: string; author: string; bot: boolean; at: number; add: number; del: number;
 *   fileCount: number; files: string[]; url: string | null }} Commit
 *
 * @typedef {{ title: string; url: string | null; author: string; bot: boolean; createdAt: number; updatedAt: number;
 *   add: number; del: number; review: 'draft' | 'approved' | 'changes' | 'waiting'; reviewText: string;
 *   checks: 'passing' | 'failing' | 'running' | 'none'; checksText: string; reviewers: string[] }} PullRequest
 *
 * @typedef {{ openPrCount: number; openPrs: PullRequest[];
 *   periods: Record<string, { merged: number; medianMergeHours: number | null; mergeSample: number;
 *     issuesOpened: number | null; issuesClosed: number | null }>;
 *   openIssues: number | null; oldestIssue: { title: string; url: string | null; createdAt: number } | null;
 *   releases: { tag: string; name: string; url: string | null; at: number; prerelease: boolean }[] }} GitHubData
 *
 * @typedef {({ state: 'ok' } & GitHubData) | { state: 'none' } | { state: 'failed'; reason: string }} GitHubPart
 *
 * @typedef {{ schema: 'git-insights.v1'; collectedAt: number; branch: string;
 *   repo: { name: string; url: string } | null; lastCommitAt: number | null;
 *   periods: Record<string, Period>; commits: Commit[];
 *   github: GitHubPart | (GitHubData & { state: 'stale'; reason: string });
 *   githubAt: number | null }} Snapshot
 *
 * One project's insights as the page shows them: its snapshot, and why its last re-read failed, if it did.
 * @typedef {Snapshot & { refresh: { at: number; reason: string } | null }} Detail
 *
 * A project on the page: read (with its row's figures and its detail, which may be trimmed to keep
 * the page within Wheelhouse's size limit), never read successfully (with why), or not read yet.
 * @typedef {{ id: string; name: string } & (
 *   | { state: 'ok'; repo: Snapshot['repo']; collectedAt: number; lastCommitAt: number | null;
 *       periods: Record<string, { commits: number; authors: number; merged: number | null }>;
 *       github: Snapshot['github']['state']; openPrCount: number | null; detail: Detail | null; trimmed: null | 'some' | 'all' }
 *   | { state: 'failed'; reason: string }
 *   | { state: 'pending' })} ProjectView
 *
 * The totals across the projects read, for one period.
 * @typedef {{ days: number; projects: number; active: number; commits: number; people: number;
 *   add: number; del: number; filesChanged: number; cadence: { unit: 'day' | 'week'; counts: number[] };
 *   github: { projects: number; openPrCount: number; merged: number; openIssues: number | null;
 *     issuesOpened: number | null; issuesClosed: number | null } | null }} Totals
 *
 * What the page is handed.
 * @typedef {{ schema: 'git-insights-overview.v1'; refreshMinutes: number; defaultDays: number;
 *   oldestAt: number | null; totals: Record<string, Totals>; projects: ProjectView[] }} Overview
 */

export {};
