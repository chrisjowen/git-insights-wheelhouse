import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DAY = 86_400_000;

/**
 * A throwaway git repository. Each commit is `{ author, daysAgo, files: { path: content }, subject }`,
 * dated `daysAgo` days before `now`.
 */
export function makeRepo(commits, { now = Date.now(), remote = null } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), 'git-insights-'));
	const git = (args, env = {}) =>
		execFileSync('git', args, {
			cwd: dir,
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: '/dev/null',
				GIT_CONFIG_SYSTEM: '/dev/null',
				...env
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}).toString();
	git(['init', '-q', '-b', 'main']);
	for (const c of commits) {
		for (const [file, content] of Object.entries(c.files)) {
			mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
			writeFileSync(path.join(dir, file), content);
			git(['add', file]);
		}
		const date = new Date(now - c.daysAgo * DAY).toISOString();
		const [name, email] = Array.isArray(c.author)
			? c.author
			: [c.author, `${c.author.toLowerCase().replace(/\W+/g, '.')}@example.com`];
		git(['commit', '-q', '-m', c.subject ?? `Change ${Object.keys(c.files).join(', ')}`], {
			GIT_AUTHOR_NAME: name,
			GIT_AUTHOR_EMAIL: email,
			GIT_COMMITTER_NAME: name,
			GIT_COMMITTER_EMAIL: email,
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_DATE: date
		});
	}
	if (remote) git(['remote', 'add', 'origin', remote]);
	return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A provider context's `exec`, as Wheelhouse gives it: no shell, a minimal
 * environment, bounded time and output. `gh` is answered by `onGh(argv)` rather
 * than run. Every call is recorded in `calls`.
 */
export function makeExec(
	dir,
	{ onGh = () => ({ ok: false, reason: 'spawn gh ENOENT', stdout: '', stderr: '' }) } = {}
) {
	const calls = [];
	const exec = (r) => {
		calls.push(r.argv);
		if (r.cwd !== 'project')
			return Promise.resolve({ ok: false, reason: 'wrong root', stdout: '', stderr: '' });
		if (r.argv[0] === 'gh') return Promise.resolve(onGh(r.argv));
		return new Promise((resolve) =>
			execFile(
				r.argv[0],
				r.argv.slice(1),
				{
					cwd: dir,
					timeout: r.timeoutMs,
					maxBuffer: r.maxBytes,
					env: {
						PATH: process.env.PATH,
						HOME: process.env.HOME,
						LANG: 'C.UTF-8',
						GIT_CONFIG_GLOBAL: '/dev/null',
						GIT_TERMINAL_PROMPT: '0',
						GIT_OPTIONAL_LOCKS: '0'
					}
				},
				(err, stdout, stderr) =>
					resolve(
						err
							? {
									ok: false,
									reason: err.message,
									stdout: String(stdout),
									stderr: String(stderr).slice(0, 4096)
								}
							: { ok: true, stdout: String(stdout) }
					)
			)
		);
	};
	return { exec, calls };
}

/** A GraphQL answer like GitHub's, for the plugin's query. */
export function githubAnswer(now, overrides = {}) {
	const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
	return {
		data: {
			repository: {
				pullRequests: {
					totalCount: 3,
					nodes: [
						{
							title: 'Render graph: passes declare targets',
							url: 'https://github.com/acme/lumen/pull/216',
							isDraft: false,
							createdAt: iso(6),
							updatedAt: iso(2),
							additions: 820,
							deletions: 240,
							reviewDecision: 'REVIEW_REQUIRED',
							author: { __typename: 'User', login: 'samchen', name: 'Sam Chen' },
							reviewRequests: {
								nodes: [
									{ requestedReviewer: { __typename: 'User', login: 'maya', name: 'Maya Okafor' } }
								]
							},
							commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }
						},
						{
							title: 'Config: read settings first',
							url: 'https://github.com/acme/lumen/pull/215',
							isDraft: false,
							createdAt: iso(4),
							updatedAt: iso(1),
							additions: 140,
							deletions: 60,
							reviewDecision: 'CHANGES_REQUESTED',
							author: { __typename: 'User', login: 'ines', name: null },
							reviewRequests: { nodes: [] },
							commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] }
						},
						{
							title: 'Bump tokio',
							url: 'https://github.com/acme/lumen/pull/208',
							isDraft: false,
							createdAt: iso(9),
							updatedAt: iso(9),
							additions: 6,
							deletions: 6,
							reviewDecision: null,
							author: { __typename: 'Bot', login: 'dependabot' },
							reviewRequests: { nodes: [] },
							commits: { nodes: [{ commit: { statusCheckRollup: null } }] }
						}
					]
				},
				issues: { totalCount: 12 },
				oldestIssue: {
					nodes: [
						{ title: 'Old one', url: 'https://github.com/acme/lumen/issues/3', createdAt: iso(41) }
					]
				},
				releases: {
					nodes: [
						{
							name: 'Lumen 0.4.2',
							tagName: 'v0.4.2',
							url: 'https://github.com/acme/lumen/releases/tag/v0.4.2',
							publishedAt: iso(6),
							isPrerelease: false,
							isDraft: false
						},
						{
							name: 'draft',
							tagName: 'v0.5.0',
							url: 'https://github.com/acme/lumen/releases/tag/v0.5.0',
							publishedAt: iso(1),
							isPrerelease: false,
							isDraft: true
						}
					]
				}
			},
			m7: { issueCount: 2 },
			m30: { issueCount: 3 },
			m90: {
				issueCount: 4,
				nodes: [
					{ createdAt: iso(3), mergedAt: iso(2) },
					{ createdAt: iso(6), mergedAt: iso(5) },
					{ createdAt: iso(25), mergedAt: iso(20) },
					{ createdAt: iso(60), mergedAt: iso(50) }
				]
			},
			io7: { issueCount: 1 },
			io30: { issueCount: 4 },
			io90: { issueCount: 9 },
			ic7: { issueCount: 2 },
			ic30: { issueCount: 5 },
			ic90: { issueCount: 11 },
			...overrides
		}
	};
}
