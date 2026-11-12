import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createPlugin } from '../wheelhouse/server/index.js';
import { aggregate, fit, overview } from '../wheelhouse/server/overview.js';
import { githubAnswer, makeExec, makeRepo } from './helpers.js';

const NOW = Date.now();
const MINUTE = 60_000;

const history = [
	{
		author: 'Ines Duarte',
		daysAgo: 120,
		files: { 'docs/guide.md': 'old\n' },
		subject: 'Start the guide'
	},
	{ author: 'Maya Okafor', daysAgo: 40, files: { 'src/renderer/mod.rs': 'a\n' } },
	{
		author: 'Maya Okafor',
		daysAgo: 10,
		files: { 'src/renderer/mod.rs': 'a\nb\n', 'package-lock.json': '{}\n' }
	},
	{
		author: 'Tom Lindqvist',
		daysAgo: 5,
		files: { 'src/cli/build.rs': 'x\n', 'src/renderer/mod.rs': 'a\nb\nc\n' }
	},
	{
		author: 'dependabot[bot]',
		daysAgo: 3,
		files: { 'package-lock.json': '{"a":1}\n' },
		subject: 'Bump a'
	},
	{
		author: 'Maya Okafor',
		daysAgo: 1,
		files: { 'src/renderer/mod.rs': 'a\nb\nc\nd\n' },
		subject: 'Fix tone mapping'
	}
];

/**
 * Ask the provider as Wheelhouse asks for its menu page: about the whole fleet,
 * with every project the plugin is on for, each command run in the clone of
 * the project it names. `execs` is each project's exec, by id.
 */
const askAll = (plugin, execs, { settings = {} } = {}) => {
	const calls = [];
	const result = plugin.providers[0].fetch({
		project: null,
		task: null,
		projects: Object.keys(execs).map((id) => ({ id, name: `The ${id}`, path: '/unused' })),
		tasks: [],
		settings,
		exec: (r) => {
			calls.push(r.project);
			return execs[r.project](r);
		},
		signal: new AbortController().signal
	});
	return result.then((r) => Object.assign(r, { calls }));
};

/** Ask about one project: `page` is the page's value, `view` the project on it and `value` its own insights. */
const ask = async (plugin, exec, { settings = {}, id = 'lumen' } = {}) => {
	const r = await askAll(plugin, { [id]: exec }, { settings });
	const view = r.value.projects[0];
	return { ...r, page: r.value, view, value: view.detail };
};

describe('the provider', () => {
	let repo;
	let local;
	before(() => {
		repo = makeRepo(history, { now: NOW, remote: 'https://github.com/acme/lumen.git' });
		local = makeRepo(history.slice(0, 3), { now: NOW });
	});
	after(() => {
		repo.cleanup();
		local.cleanup();
	});

	it('reads the history and GitHub into one snapshot', async () => {
		const { exec } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		const r = await ask(createPlugin({ now: () => NOW }), exec);
		assert.equal(r.available, true);
		assert.equal(r.view.state, 'ok');
		assert.deepEqual(
			r.calls.filter((id) => id !== 'lumen'),
			[]
		);
		const v = r.value;
		assert.equal(v.schema, 'git-insights.v1');
		assert.equal(r.page.refreshMinutes, 60);
		assert.equal(r.page.defaultDays, 30);
		assert.equal(v.refresh, null);
		assert.deepEqual(v.repo, { name: 'acme/lumen', url: 'https://github.com/acme/lumen' });
		assert.equal(v.branch, 'main');
		assert.equal(v.periods[30].commits, 4);
		assert.equal(v.periods[90].commits, 5);
		assert.equal(v.periods[30].people[0].name, 'Maya Okafor');
		// Lock files are left out of hotspots by default.
		assert.equal(v.periods[30].hotspots[0].file, 'src/renderer/mod.rs');
		assert.ok(!v.periods[30].hotspots.some((h) => h.file === 'package-lock.json'));
		// Ines committed before the quarter, so nobody is new in it but Maya and Tom.
		assert.deepEqual(v.periods[90].newPeople.sort(), ['Maya Okafor', 'Tom Lindqvist']);
		assert.equal(v.commits[0].subject, 'Fix tone mapping');
		assert.match(v.commits[0].url, /^https:\/\/github\.com\/acme\/lumen\/commit\/[0-9a-f]{40}$/);
		assert.equal(v.github.state, 'ok');
		assert.equal(v.github.openPrs.length, 3);
		assert.equal(v.githubAt, NOW);
		assert.equal(r.view.periods[30].commits, 4);
		assert.equal(r.view.openPrCount, 3);
		assert.ok(JSON.stringify(r.page).length < 256 * 1024);
	});

	it('only reads: git log, shortlog and config lookups, and one GitHub query', async () => {
		const { exec, calls } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		await ask(createPlugin({ now: () => NOW }), exec);
		const READS = new Set(['log', 'shortlog', 'symbolic-ref', 'remote']);
		for (const argv of calls) {
			if (argv[0] === 'git') {
				const sub = argv.find((a, i) => i > 0 && !a.startsWith('-') && argv[i - 1] !== '-c');
				assert.ok(READS.has(sub), `unexpected git ${sub}`);
				if (sub === 'remote') assert.deepEqual(argv.slice(-2), ['get-url', 'origin']);
			} else {
				assert.deepEqual(argv.slice(0, 3), ['gh', 'api', 'graphql']);
				assert.ok(!argv.some((a) => /mutation/.test(a)));
			}
		}
	});

	it('sends an all-digit owner and repository name to GitHub as strings', async () => {
		const numeric = makeRepo(history.slice(0, 1), {
			now: NOW,
			remote: 'https://github.com/1234/2048.git'
		});
		try {
			const { exec, calls } = makeExec(numeric.dir, {
				onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
			});
			await ask(createPlugin({ now: () => NOW }), exec);
			const gh = calls.find((a) => a[0] === 'gh');
			const flagOf = (field) => gh[gh.indexOf(field) - 1];
			assert.equal(flagOf('owner=1234'), '-f');
			assert.equal(flagOf('name=2048'), '-f');
		} finally {
			numeric.cleanup();
		}
	});

	it('shows the history alone, and says why, when the clone has no GitHub remote', async () => {
		const { exec, calls } = makeExec(local.dir);
		const r = await ask(createPlugin({ now: () => NOW }), exec);
		assert.equal(r.value.github.state, 'none');
		assert.equal(r.value.repo, null);
		assert.equal(r.value.commits[0].url, null);
		assert.ok(!calls.some((a) => a[0] === 'gh'));
	});

	it('keeps the history when GitHub fails, with a plain reason', async () => {
		const { exec } = makeExec(repo.dir, {
			onGh: () => ({
				ok: false,
				reason: 'exited with code 4',
				stdout: '',
				stderr: 'To get started with GitHub CLI, please run:  gh auth login'
			})
		});
		const r = await ask(createPlugin({ now: () => NOW }), exec);
		assert.equal(r.available, true);
		assert.equal(r.value.github.state, 'failed');
		assert.match(r.value.github.reason, /signed in/);
		assert.equal(r.value.periods[30].commits, 4);
	});

	it('reads once per refresh interval, not on every ask', async () => {
		let at = NOW;
		const { exec, calls } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		const plugin = createPlugin({ now: () => at });
		await ask(plugin, exec);
		const reads = calls.length;
		at += 59 * MINUTE;
		const again = await ask(plugin, exec);
		assert.equal(calls.length, reads);
		assert.equal(again.value.collectedAt, NOW);
		at += 2 * MINUTE;
		const fresh = await ask(plugin, exec);
		assert.ok(calls.length > reads);
		assert.equal(fresh.value.collectedAt, at);
	});

	it('follows the refresh interval setting, kept within 5 minutes and a day', async () => {
		let at = NOW;
		const { exec, calls } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		const plugin = createPlugin({ now: () => at });
		const settings = { refreshMinutes: 1 };
		const first = await askAll(plugin, { lumen: exec }, { settings });
		assert.equal(first.value.refreshMinutes, 5);
		const reads = calls.length;
		at += 4 * MINUTE;
		await ask(plugin, exec, { settings });
		assert.equal(calls.length, reads);
		at += 2 * MINUTE;
		await ask(plugin, exec, { settings });
		assert.ok(calls.length > reads);
	});

	it('reads again at once when a setting that changes what is read changes', async () => {
		const { exec, calls } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		const plugin = createPlugin({ now: () => NOW });
		await ask(plugin, exec);
		const reads = calls.length;
		const r = await ask(plugin, exec, { settings: { includeBots: false, defaultDays: '7' } });
		assert.ok(calls.length > reads);
		assert.equal(r.view.state, 'ok');
		assert.equal(
			(await askAll(plugin, { lumen: exec }, { settings: { defaultDays: '7' } })).value.defaultDays,
			7
		);
		assert.ok(!r.value.periods[30].people.some((p) => p.bot));
		assert.equal(r.value.github.openPrCount, 2);
	});

	it('keeps the last snapshot, says so, and waits a few minutes when a re-read fails', async () => {
		let at = NOW;
		let broken = false;
		const good = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		let count = 0;
		const exec = (r) => {
			count += 1;
			return broken
				? Promise.resolve({
						ok: false,
						reason: 'exited with code 128',
						stdout: '',
						stderr: 'fatal: not a git repository'
					})
				: good.exec(r);
		};
		const plugin = createPlugin({ now: () => at });
		await ask(plugin, exec);
		broken = true;
		at += 61 * MINUTE;
		const r = await ask(plugin, exec);
		assert.equal(r.available, true);
		assert.equal(r.value.collectedAt, NOW);
		assert.match(r.value.refresh.reason, /isn’t a git clone/);
		const tried = count;
		at += 2 * MINUTE;
		await ask(plugin, exec);
		assert.equal(count, tried);
		broken = false;
		at += 4 * MINUTE;
		const back = await ask(plugin, exec);
		assert.equal(back.value.refresh, null);
		assert.equal(back.value.collectedAt, at);
	});

	it('keeps what GitHub said last time, marked as older, when GitHub fails later', async () => {
		let at = NOW;
		let ghUp = true;
		const { exec } = makeExec(repo.dir, {
			onGh: () =>
				ghUp
					? { ok: true, stdout: JSON.stringify(githubAnswer(NOW)) }
					: { ok: false, reason: 'timed out after 9000 ms', stdout: '', stderr: '' }
		});
		const plugin = createPlugin({ now: () => at });
		await ask(plugin, exec);
		ghUp = false;
		at += 61 * MINUTE;
		const r = await ask(plugin, exec);
		assert.equal(r.value.github.state, 'stale');
		assert.match(r.value.github.reason, /too long/);
		assert.equal(r.value.github.openPrs.length, 3);
		assert.equal(r.value.githubAt, NOW);
		assert.equal(r.value.collectedAt, at);
	});

	it('says plainly when the folder is not a git clone', async () => {
		const { exec } = makeExec('/');
		const r = await ask(createPlugin({ now: () => NOW }), exec);
		assert.equal(r.available, true);
		assert.deepEqual(r.view, {
			id: 'lumen',
			name: 'The lumen',
			state: 'failed',
			reason: 'This project’s folder isn’t a git clone.'
		});
	});

	it('says plainly when the clone has no commits', async () => {
		const empty = makeRepo([]);
		try {
			const { exec } = makeExec(empty.dir);
			const r = await ask(createPlugin({ now: () => NOW }), exec);
			assert.equal(r.view.state, 'failed');
			assert.equal(r.view.reason, 'This project’s clone has no commits yet.');
		} finally {
			empty.cleanup();
		}
	});

	it('prefers the branch origin points at', async () => {
		repo.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
		repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
		const { exec, calls } = makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		});
		const r = await ask(createPlugin({ now: () => NOW }), exec);
		assert.equal(r.value.branch, 'main');
		assert.ok(calls.some((a) => a.includes('log') && a.includes('origin/main')));
	});
});

describe('the page across projects', () => {
	let repo;
	let local;
	before(() => {
		repo = makeRepo(history, { now: NOW, remote: 'https://github.com/acme/lumen.git' });
		local = makeRepo(history.slice(0, 3), { now: NOW });
	});
	after(() => {
		repo.cleanup();
		local.cleanup();
	});

	const execs = () => ({
		lumen: makeExec(repo.dir, {
			onGh: () => ({ ok: true, stdout: JSON.stringify(githubAnswer(NOW)) })
		}).exec,
		atlas: makeExec(local.dir).exec
	});

	it('reads each project in its own clone and adds them up', async () => {
		const r = await askAll(createPlugin({ now: () => NOW }), execs());
		assert.equal(r.available, true);
		assert.equal(r.value.schema, 'git-insights-overview.v1');
		assert.deepEqual(new Set(r.calls), new Set(['lumen', 'atlas']));
		assert.deepEqual(
			r.value.projects.map((p) => [p.id, p.name, p.state]),
			[
				['lumen', 'The lumen', 'ok'],
				['atlas', 'The atlas', 'ok']
			]
		);
		const [lumen, atlas] = r.value.projects;
		assert.equal(lumen.periods[30].commits, 4);
		assert.equal(atlas.periods[30].commits, 1);
		assert.equal(atlas.openPrCount, null);
		assert.equal(atlas.github, 'none');
		assert.equal(lumen.github, 'ok');
		assert.equal(atlas.detail.github.state, 'none');

		const t = r.value.totals[30];
		assert.equal(t.projects, 2);
		assert.equal(t.active, 2);
		assert.equal(t.commits, 5);
		// Maya committed to both, and counts once.
		assert.equal(t.people, 3);
		assert.equal(
			t.cadence.counts.reduce((a, b) => a + b, 0),
			5
		);
		assert.equal(t.github.projects, 1);
		assert.equal(t.github.openPrCount, 3);
		assert.equal(t.github.merged, 3);
		assert.equal(t.github.openIssues, 12);
		assert.equal(r.value.totals[90].commits, 5 + 2);
		assert.equal(r.source, 'the git history and GitHub');
		assert.equal(r.observedAt, new Date(NOW).toISOString());
	});

	it('says why a project could not be read, shows the others, and waits before trying it again', async () => {
		let at = NOW;
		let broken = 0;
		const fine = execs();
		const plugin = createPlugin({ now: () => at });
		const all = {
			...fine,
			atlas: () => {
				broken += 1;
				return Promise.resolve({
					ok: false,
					reason: 'exited with code 128',
					stdout: '',
					stderr: 'fatal: not a git repository'
				});
			}
		};
		const r = await askAll(plugin, all);
		const atlas = r.value.projects.find((p) => p.id === 'atlas');
		assert.deepEqual(atlas, {
			id: 'atlas',
			name: 'The atlas',
			state: 'failed',
			reason: 'This project’s folder isn’t a git clone.'
		});
		assert.equal(r.value.totals[30].projects, 1);
		assert.equal(r.value.totals[30].commits, 4);
		const tried = broken;
		at += 2 * MINUTE;
		await askAll(plugin, all);
		assert.equal(broken, tried);
		at += 4 * MINUTE;
		await askAll(plugin, all);
		assert.ok(broken > tried);
	});

	it('leaves projects it has no time for to the next ask', async () => {
		let late = true;
		// The first look at the clock starts the call; later looks find it nearly over.
		let looks = 0;
		const clock = () => (late && looks++ > 0 ? 7_000 : 0);
		const plugin = createPlugin({ now: () => NOW, clock });
		const r = await askAll(plugin, execs());
		assert.deepEqual(
			r.value.projects.map((p) => p.state),
			['pending', 'pending']
		);
		assert.equal(r.value.oldestAt, null);
		assert.equal(r.observedAt, null);
		late = false;
		const again = await askAll(plugin, execs());
		assert.deepEqual(
			again.value.projects.map((p) => p.state),
			['ok', 'ok']
		);
	});

	it('forgets a project the plugin is turned off for', async () => {
		const plugin = createPlugin({ now: () => NOW });
		const both = execs();
		await askAll(plugin, both);
		await askAll(plugin, { lumen: both.lumen });
		const { calls } = await askAll(plugin, both);
		assert.deepEqual(
			calls.filter((id) => id === 'lumen'),
			[]
		);
		assert.ok(calls.includes('atlas'));
	});

	it('is not available when the plugin is on for no project', async () => {
		const r = await askAll(createPlugin({ now: () => NOW }), {});
		assert.equal(r.available, false);
	});

	it('keeps the page within what Wheelhouse will show by trimming the largest detail first', async () => {
		const r = await askAll(createPlugin({ now: () => NOW }), execs());
		const page = r.value;
		const size = (v) => JSON.stringify(v).length;
		const lumenBytes = size(page.projects[0].detail);
		// Within the budget, nothing changes.
		assert.deepEqual(fit(structuredClone(page), size(page)), page);

		// Just too big: the largest project loses what opens in place, and nothing else changes.
		const some = fit(structuredClone(page), size(page) - 50);
		assert.equal(some.projects[0].trimmed, 'some');
		assert.equal(some.projects[1].trimmed, null);
		assert.ok(some.projects[0].detail.commits.every((c) => c.files.length === 0));
		assert.ok(some.projects[0].detail.periods[30].people.every((p) => p.recent.length === 0));
		assert.ok(size(some) <= size(page) - 50);

		// Far too big: detail goes, largest first, and the rows and totals stay.
		const none = fit(structuredClone(page), size(page) - lumenBytes);
		assert.equal(none.projects[0].trimmed, 'all');
		assert.equal(none.projects[0].detail, null);
		assert.equal(none.projects[0].periods[30].commits, 4);
		assert.deepEqual(none.totals, page.totals);
	});
});

describe('the totals', () => {
	/** A snapshot with only what the totals read. */
	const snap = (people, authors, extra = {}) => {
		const periods = {};
		for (const days of [7, 30, 90]) {
			const buckets = days > 31 ? Math.ceil(days / 7) : days;
			periods[days] = {
				commits: people.length,
				authors,
				add: 10,
				del: 2,
				filesChanged: 3,
				cadence: { unit: days > 31 ? 'week' : 'day', counts: new Array(buckets).fill(0) },
				people: people.map((name) => ({ name }))
			};
		}
		return { github: { state: 'none' }, periods, ...extra };
	};

	it('counts each person once, and those past a project’s listed people as their own', () => {
		const t = aggregate([snap(['Maya', 'Tom'], 2), snap(['Maya', 'Ines'], 20)])[30];
		// Maya, Tom and Ines, plus the 18 the second project does not list.
		assert.equal(t.people, 3 + 18);
		assert.equal(t.add, 20);
		assert.equal(t.filesChanged, 6);
		assert.equal(t.github, null);
	});

	it('adds GitHub up only where GitHub was read, keeping what is unknown unknown', () => {
		const gh = (openPrCount, openIssues, issuesOpened) => ({
			github: {
				state: 'stale',
				openPrCount,
				openIssues,
				periods: {
					7: { merged: 1, issuesOpened, issuesClosed: null },
					30: { merged: 2, issuesOpened, issuesClosed: null },
					90: { merged: 3, issuesOpened, issuesClosed: null }
				}
			}
		});
		const t = aggregate([
			snap(['Maya'], 1, gh(4, null, null)),
			snap(['Tom'], 1, gh(1, 7, 2)),
			snap([], 0)
		])[30];
		assert.deepEqual(t.github, {
			projects: 2,
			openPrCount: 5,
			merged: 4,
			openIssues: 7,
			issuesOpened: 2,
			issuesClosed: null
		});
		assert.equal(t.projects, 3);
		assert.equal(t.active, 2);
	});

	it('lists projects in the order given, read or not', () => {
		const read = new Map([['b', { snapshot: null, failed: { at: NOW, reason: 'Nope.' } }]]);
		const v = overview(
			[
				{ id: 'a', name: '' },
				{ id: 'b', name: 'Bee' }
			],
			read,
			{ refreshMinutes: 60, defaultDays: 30 }
		);
		assert.deepEqual(v.projects, [
			{ id: 'a', name: 'a', state: 'pending' },
			{ id: 'b', name: 'Bee', state: 'failed', reason: 'Nope.' }
		]);
		assert.equal(v.totals[30].projects, 0);
	});
});
