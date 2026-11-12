/**
 * Reading a project's history: the clone's git log and, when the clone's
 * `origin` is on GitHub, one GraphQL query through `gh`. Everything here goes
 * through the provider context's `exec` (an argument array, no shell, bounded
 * time and output), reads only, and turns what it reads into one plain-JSON
 * snapshot the page draws. The parsing and counting are pure functions, exported
 * for the tests.
 *
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').Period} Period
 * @typedef {import('./types.js').GitHubData} GitHubData
 */

export const PERIODS = [7, 30, 90];
/** The longest period: the git log is read this far back, once, and counted per period. */
const SPAN_DAYS = 90;
const DAY = 86_400_000;
/** At most this many commits are read, however busy the repository. */
const MAX_COMMITS = 5000;
const LATEST = 30;
const PEOPLE = 15;
const HOTSPOTS = 12;
const FILES_PER_COMMIT = 12;
const OPEN_PRS = 50;
const MAX_TITLE = 200;
/** Folders that only hold other folders, so a person's area is the folder under them. */
const CONTAINERS = new Set([
	'src',
	'lib',
	'app',
	'apps',
	'packages',
	'crates',
	'cmd',
	'internal',
	'pkg',
	'modules',
	'services'
]);
const BOT = /\[bot\]$|^(dependabot|renovate|github-actions|greenkeeper|snyk-bot)\b/i;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RS = '\x1e';
const US = '\x1f';
const LOG_FORMAT = `${RS}%H${US}%aN${US}%at${US}%s`;

/** One line of plain text, at most `max` characters. */
export function clean(text, max = MAX_TITLE) {
	const t = String(text ?? '')
		.replace(/[\p{Cc}\s]+/gu, ' ')
		.trim();
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const isBot = (name) => BOT.test(name);

/** The `owner/repo` of a GitHub remote URL, or null. */
export function githubRepo(remote) {
	const s = String(remote ?? '').trim();
	const scp = /^[\w.-]+@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s);
	if (scp) return scp[1];
	let u;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol) || u.hostname !== 'github.com') {
		return null;
	}
	return /^\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname)?.[1] ?? null;
}

/**
 * The commits in `git log --format=<LOG_FORMAT> --numstat --no-renames` output,
 * newest first: who, when (ms), the subject, and each file's added and removed
 * lines (null for a binary file).
 */
export function parseLog(out) {
	const commits = [];
	for (const chunk of out.split(RS)) {
		if (!chunk.trim()) continue;
		const [head, ...lines] = chunk.split('\n');
		const [sha, author, at, ...subject] = head.split(US);
		if (!sha || !/^[0-9a-f]{7,64}$/.test(sha)) continue;
		const files = [];
		for (const line of lines) {
			const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
			if (!m) continue;
			files.push({
				path: m[3],
				add: m[1] === '-' ? null : Number(m[1]),
				del: m[2] === '-' ? null : Number(m[2])
			});
		}
		commits.push({
			sha,
			author: clean(author, 100) || 'Someone',
			at: Number(at) * 1000,
			subject: clean(subject.join(US)),
			files
		});
	}
	return commits;
}

/** The names in `git shortlog -s` output. */
export function parseShortlog(out) {
	const names = new Set();
	for (const line of out.split('\n')) {
		const m = /^\s*\d+\s+(.+?)\s*$/.exec(line);
		if (m) names.add(m[1]);
	}
	return names;
}

/** Glob-ish patterns: `*` within a name, a trailing `/` for a folder, else a file name or a path. */
export function ignoreMatcher(patterns) {
	const rules = (Array.isArray(patterns) ? patterns : [])
		.filter((p) => typeof p === 'string' && p.trim())
		.map((p) => {
			const pat = p.trim();
			if (pat.endsWith('/')) {
				const dir = pat.replace(/^\/+/, '');
				return (path) => path.startsWith(dir) || path.includes(`/${dir}`);
			}
			const re = new RegExp(
				`^${pat
					.replace(/^\/+/, '')
					.split('*')
					.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
					.join('[^/]*')}$`
			);
			return pat.includes('/')
				? (path) => re.test(path)
				: (path) => re.test(path.slice(path.lastIndexOf('/') + 1));
		});
	return (path) => rules.some((r) => r(path));
}

/** The part of the repository a file belongs to, as people would name it, or null for a top-level file. */
export function areaOf(path) {
	const parts = path.split('/');
	if (parts.length < 2) return null;
	if (CONTAINERS.has(parts[0]) && parts.length > 2) return parts[1];
	return parts[0];
}

const lines = (files, key) => files.reduce((n, f) => n + (f[key] ?? 0), 0);
const top = (counts, n) =>
	[...counts.entries()]
		.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
		.slice(0, n)
		.map(([k]) => k);

/**
 * Counts for one period from the commits (newest first): people, hotspots,
 * cadence and totals. `before` is the set of people with commits before the
 * period started (null when unknown), for who is new.
 *
 * @returns {Period}
 */
export function summarise(commits, { days, now, ignore, before, commitUrl }) {
	const start = now - days * DAY;
	const inPeriod = commits.filter((c) => c.at >= start);
	const weekly = days > 31;
	const buckets = weekly ? Math.ceil(days / 7) : days;
	const width = weekly ? 7 * DAY : DAY;
	const bucket = (at) =>
		Math.min(buckets - 1, Math.max(0, buckets - 1 - Math.floor((now - at) / width)));

	const cadence = new Array(buckets).fill(0);
	const weekdays = new Array(7).fill(0);
	const people = new Map();
	const files = new Map();
	const allFiles = new Set();
	let add = 0;
	let del = 0;

	for (const c of inPeriod) {
		cadence[bucket(c.at)] += 1;
		weekdays[new Date(c.at).getDay()] += 1;
		const cAdd = lines(c.files, 'add');
		const cDel = lines(c.files, 'del');
		add += cAdd;
		del += cDel;

		let p = people.get(c.author);
		if (!p) {
			p = {
				name: c.author,
				bot: isBot(c.author),
				commits: 0,
				add: 0,
				del: 0,
				lastAt: c.at,
				areas: new Map(),
				spark: new Array(buckets).fill(0),
				recent: []
			};
			people.set(c.author, p);
		}
		p.commits += 1;
		p.add += cAdd;
		p.del += cDel;
		p.lastAt = Math.max(p.lastAt, c.at);
		p.spark[bucket(c.at)] += 1;
		if (p.recent.length < 4) p.recent.push({ subject: c.subject, at: c.at, url: commitUrl(c.sha) });

		const areas = new Set();
		for (const f of c.files) {
			allFiles.add(f.path);
			const a = areaOf(f.path);
			if (a) areas.add(a);
			if (ignore(f.path)) continue;
			let h = files.get(f.path);
			if (!h) {
				h = {
					file: f.path,
					changes: 0,
					add: 0,
					del: 0,
					lastAt: c.at,
					people: new Map(),
					recent: []
				};
				files.set(f.path, h);
			}
			h.changes += 1;
			h.add += f.add ?? 0;
			h.del += f.del ?? 0;
			h.lastAt = Math.max(h.lastAt, c.at);
			h.people.set(c.author, (h.people.get(c.author) ?? 0) + 1);
			if (h.recent.length < 3) h.recent.push({ subject: c.subject, who: c.author, at: c.at });
		}
		for (const a of areas) p.areas.set(a, (p.areas.get(a) ?? 0) + 1);
	}

	const busiest = weekdays.indexOf(Math.max(...weekdays));
	// Nobody is new in a repository whose history starts inside the period.
	const newPeople = before?.size
		? [...people.values()].filter((p) => !p.bot && !before.has(p.name)).map((p) => p.name)
		: [];

	return {
		days,
		commits: inPeriod.length,
		authors: people.size,
		add,
		del,
		filesChanged: allFiles.size,
		cadence: { unit: weekly ? 'week' : 'day', counts: cadence },
		busiestDay: inPeriod.length
			? { name: WEEKDAYS[busiest], share: weekdays[busiest] / inPeriod.length }
			: null,
		people: [...people.values()]
			.sort((a, b) => b.commits - a.commits || b.lastAt - a.lastAt)
			.slice(0, PEOPLE)
			.map((p) => ({ ...p, areas: top(p.areas, 3) })),
		hotspots: [...files.values()]
			.sort(
				(a, b) => b.changes - a.changes || b.add + b.del - (a.add + a.del) || b.lastAt - a.lastAt
			)
			.slice(0, HOTSPOTS)
			.map((h) => ({ ...h, people: top(h.people, 5) })),
		newPeople
	};
}

/** The latest commits, each with its first few files. */
export function latestCommits(commits, commitUrl) {
	return commits.slice(0, LATEST).map((c) => ({
		subject: c.subject,
		author: c.author,
		bot: isBot(c.author),
		at: c.at,
		add: lines(c.files, 'add'),
		del: lines(c.files, 'del'),
		fileCount: c.files.length,
		files: c.files.slice(0, FILES_PER_COMMIT).map((f) => f.path),
		url: commitUrl(c.sha)
	}));
}

const median = (xs) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const REVIEW = {
	APPROVED: ['approved', 'Approved'],
	CHANGES_REQUESTED: ['changes', 'Changes asked for'],
	REVIEW_REQUIRED: ['waiting', 'Waiting for review']
};
const CHECKS = {
	SUCCESS: ['passing', 'Checks passing'],
	FAILURE: ['failing', 'Checks failing'],
	ERROR: ['failing', 'Checks failing'],
	PENDING: ['running', 'Checks running'],
	EXPECTED: ['running', 'Checks running']
};

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/github\.com\//.test(u) ? u : null);
const personName = (a) => clean(a?.name || a?.login || 'Someone', 100);

/**
 * A project's GitHub part from the GraphQL answer: open pull requests (waiting
 * longest first) with their review and checks state, merged counts and the
 * median time to merge per period, issues and releases.
 *
 * @returns {GitHubData}
 */
export function parseGitHub(data, now) {
	const repo = data?.repository;
	if (!repo) throw new Error('GitHub sent no repository');
	const prs = (repo.pullRequests?.nodes ?? []).filter(Boolean).map((p) => {
		const [review, reviewText] = p.isDraft
			? ['draft', 'Draft']
			: (REVIEW[p.reviewDecision] ?? ['waiting', 'Waiting for review']);
		const rollup = p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
		const [checks, checksText] = CHECKS[rollup] ?? ['none', 'No checks'];
		return {
			title: clean(p.title),
			url: safeUrl(p.url),
			author: personName(p.author),
			bot: p.author?.__typename === 'Bot' || isBot(p.author?.login ?? ''),
			createdAt: Date.parse(p.createdAt),
			updatedAt: Date.parse(p.updatedAt),
			add: p.additions ?? 0,
			del: p.deletions ?? 0,
			review,
			reviewText,
			checks,
			checksText,
			reviewers: (p.reviewRequests?.nodes ?? [])
				.map((r) => r?.requestedReviewer)
				.filter(Boolean)
				.map((r) => clean(r.name || r.login || 'a team', 100))
		};
	});
	const merged = (data.m90?.nodes ?? [])
		.filter((n) => n?.createdAt && n?.mergedAt)
		.map((n) => ({ createdAt: Date.parse(n.createdAt), mergedAt: Date.parse(n.mergedAt) }));
	const periods = {};
	for (const days of PERIODS) {
		const inPeriod = merged.filter((m) => m.mergedAt >= now - days * DAY);
		periods[days] = {
			merged: data[`m${days}`]?.issueCount ?? inPeriod.length,
			medianMergeHours: median(inPeriod.map((m) => (m.mergedAt - m.createdAt) / 3_600_000)),
			mergeSample: inPeriod.length,
			issuesOpened: data[`io${days}`]?.issueCount ?? null,
			issuesClosed: data[`ic${days}`]?.issueCount ?? null
		};
	}
	const oldest = repo.oldestIssue?.nodes?.[0];
	return {
		openPrCount: repo.pullRequests?.totalCount ?? prs.length,
		openPrs: prs,
		periods,
		openIssues: repo.issues?.totalCount ?? null,
		oldestIssue: oldest
			? {
					title: clean(oldest.title),
					url: safeUrl(oldest.url),
					createdAt: Date.parse(oldest.createdAt)
				}
			: null,
		releases: (repo.releases?.nodes ?? [])
			.filter((r) => r && !r.isDraft)
			.map((r) => ({
				tag: clean(r.tagName, 80),
				name: clean(r.name || r.tagName, 120),
				url: safeUrl(r.url),
				at: Date.parse(r.publishedAt),
				prerelease: !!r.isPrerelease
			}))
	};
}

export const GITHUB_QUERY = `query($owner: String!, $name: String!, $m7: String!, $m30: String!, $m90: String!, $io7: String!, $io30: String!, $io90: String!, $ic7: String!, $ic30: String!, $ic90: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${OPEN_PRS}, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      nodes {
        title url isDraft createdAt updatedAt additions deletions reviewDecision
        author { __typename login ... on User { name } }
        reviewRequests(first: 5) { nodes { requestedReviewer { __typename ... on User { login name } ... on Team { name } ... on Bot { login } } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
    issues(states: OPEN) { totalCount }
    oldestIssue: issues(states: OPEN, first: 1, orderBy: {field: CREATED_AT, direction: ASC}) { nodes { title url createdAt } }
    releases(first: 3, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { name tagName url publishedAt isPrerelease isDraft } }
  }
  m7: search(query: $m7, type: ISSUE) { issueCount }
  m30: search(query: $m30, type: ISSUE) { issueCount }
  m90: search(query: $m90, type: ISSUE, first: 100) { issueCount nodes { ... on PullRequest { createdAt mergedAt } } }
  io7: search(query: $io7, type: ISSUE) { issueCount }
  io30: search(query: $io30, type: ISSUE) { issueCount }
  io90: search(query: $io90, type: ISSUE) { issueCount }
  ic7: search(query: $ic7, type: ISSUE) { issueCount }
  ic30: search(query: $ic30, type: ISSUE) { issueCount }
  ic90: search(query: $ic90, type: ISSUE) { issueCount }
}`;

/** The `gh api graphql` arguments for a repository at `now`. */
export function githubArgs(repo, now) {
	const [owner, name] = repo.split('/');
	const since = (days) => new Date(now - days * DAY).toISOString().slice(0, 10);
	const args = [
		'gh',
		'api',
		'graphql',
		'-f',
		`query=${GITHUB_QUERY}`,
		'-f',
		`owner=${owner}`,
		'-f',
		`name=${name}`
	];
	for (const d of PERIODS) {
		args.push('-f', `m${d}=repo:${repo} is:pr is:merged merged:>=${since(d)} sort:updated-desc`);
		args.push('-f', `io${d}=repo:${repo} is:issue created:>=${since(d)}`);
		args.push('-f', `ic${d}=repo:${repo} is:issue closed:>=${since(d)}`);
	}
	return args;
}

/** Why `gh` failed, in words the captain can act on. */
export function githubReason(r) {
	const text = `${r.reason ?? ''} ${r.stderr ?? ''}`;
	if (/ENOENT|not found: gh|command not found|spawn gh/i.test(text)) {
		return "GitHub's command-line tool (gh) isn't installed, so pull requests, issues and releases can't be read.";
	}
	if (/auth login|not logged|authentication|HTTP 401|bad credentials/i.test(text)) {
		return 'The GitHub command-line tool isn’t signed in, so pull requests, issues and releases can’t be read.';
	}
	if (/timed out|timeout|aborted/i.test(text)) return 'GitHub took too long to answer.';
	if (/Could not resolve to a Repository|NOT_FOUND|HTTP 404/i.test(text)) {
		return 'GitHub says this repository doesn’t exist, or this account can’t see it.';
	}
	if (/rate limit/i.test(text))
		return 'GitHub’s rate limit was reached; it will be tried again later.';
	if (/could not resolve host|network|dial tcp|connection/i.test(text))
		return 'GitHub couldn’t be reached.';
	return 'GitHub couldn’t be read just now.';
}

/** Why the git log could not be read, in plain words. */
function gitReason(r) {
	const text = `${r.reason ?? ''} ${r.stderr ?? ''}`;
	if (/not a git repository/i.test(text)) return 'This project’s folder isn’t a git clone.';
	if (/does not have any commits|bad default revision|unknown revision/i.test(text)) {
		return 'This project’s clone has no commits yet.';
	}
	if (/ENOENT|spawn git/i.test(text)) return 'git isn’t installed, so the history can’t be read.';
	if (/timed out|timeout|aborted/i.test(text)) return 'Reading the history took too long.';
	if (/no .* directory to run in/i.test(text)) return 'This project has no clone to read.';
	return 'The project’s history couldn’t be read.';
}

export class CollectError extends Error {}

/**
 * Read the project once: the git log through `ctx.exec`, and GitHub when the
 * clone's origin is there. A git failure throws a CollectError with a plain
 * reason; a GitHub failure becomes `github.state: 'failed'`, so the history
 * still shows.
 *
 * @param {import('./types.js').Exec} exec
 * @returns {Promise<Snapshot>}
 */
export async function collect(exec, { now, ignore, includeBots, budgetMs }) {
	const run = (argv, maxBytes = 1024 * 1024) =>
		exec({ argv, cwd: 'project', timeoutMs: budgetMs, maxBytes });
	const git = (...args) => run(['git', '--no-pager', '-c', 'core.quotepath=off', ...args]);

	// The branch other people's work lands on: origin's default when the clone knows it.
	const [originHead, remote, current] = await Promise.all([
		git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'),
		git('remote', 'get-url', 'origin'),
		git('symbolic-ref', '--quiet', '--short', 'HEAD')
	]);
	const ref = originHead.ok && originHead.stdout.trim() ? originHead.stdout.trim() : 'HEAD';
	// The branch by name: origin's default, else the one checked out (none when detached).
	const branch =
		ref === 'HEAD' ? (current.ok && current.stdout.trim()) || null : ref.replace(/^origin\//, '');
	const repo = remote.ok ? githubRepo(remote.stdout) : null;
	const commitUrl = repo ? (sha) => `https://github.com/${repo}/commit/${sha}` : () => null;

	const since = (days) => `--since=${new Date(now - days * DAY).toISOString()}`;
	const before = (days) => `--before=${new Date(now - days * DAY).toISOString()}`;
	// GitHub is asked at the same time as git, so the slower of the two sets the pace.
	const github = repo ? run(githubArgs(repo, now), 2 * 1024 * 1024) : null;
	const [log, last, ...earlier] = await Promise.all([
		run(
			[
				'git',
				'--no-pager',
				'-c',
				'core.quotepath=off',
				'log',
				ref,
				since(SPAN_DAYS),
				'--no-merges',
				`--max-count=${MAX_COMMITS}`,
				'--no-renames',
				'--numstat',
				`--format=${LOG_FORMAT}`
			],
			8 * 1024 * 1024
		),
		git('log', ref, '-1', '--format=%at'),
		...PERIODS.map((d) => git('shortlog', '-s', before(d), ref))
	]);
	if (!last.ok) throw new CollectError(gitReason(last));
	if (!log.ok) throw new CollectError(gitReason(log));

	let commits = parseLog(log.stdout);
	if (!includeBots) commits = commits.filter((c) => !isBot(c.author));
	const periods = {};
	PERIODS.forEach((days, i) => {
		const b = earlier[i];
		periods[days] = summarise(commits, {
			days,
			now,
			ignore,
			before: b.ok ? parseShortlog(b.stdout) : null,
			commitUrl
		});
	});

	/** @type {Snapshot} */
	const snapshot = {
		schema: 'git-insights.v1',
		collectedAt: now,
		branch,
		repo: repo ? { name: repo, url: `https://github.com/${repo}` } : null,
		lastCommitAt: Number(last.stdout.trim()) * 1000 || null,
		periods,
		commits: latestCommits(commits, commitUrl),
		github: repo
			? { state: 'failed', reason: 'GitHub couldn’t be read just now.' }
			: { state: 'none' },
		githubAt: null
	};
	if (!repo) return snapshot;

	const gh = await github;
	if (!gh.ok) {
		snapshot.github = { state: 'failed', reason: githubReason(gh) };
		return snapshot;
	}
	try {
		const answer = JSON.parse(gh.stdout);
		if (answer.errors?.length && !answer.data?.repository) {
			snapshot.github = {
				state: 'failed',
				reason: githubReason({ stderr: JSON.stringify(answer.errors) })
			};
			return snapshot;
		}
		const data = parseGitHub(answer.data, now);
		if (!includeBots) {
			const people = data.openPrs.filter((p) => !p.bot);
			data.openPrCount -= data.openPrs.length - people.length;
			data.openPrs = people;
		}
		snapshot.github = { state: 'ok', ...data };
		snapshot.githubAt = now;
	} catch {
		snapshot.github = { state: 'failed', reason: 'GitHub sent an answer that couldn’t be read.' };
	}
	return snapshot;
}
