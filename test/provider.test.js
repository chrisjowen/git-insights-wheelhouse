import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createPlugin } from '../wheelhouse/server/index.js';
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

/** Ask the provider as Wheelhouse would, at `at`. */
const ask = (plugin, exec, { at, settings = {}, id = 'lumen' } = {}) => {
	const provider = plugin.providers[0];
	return provider.fetch({
		project: { id, path: '/unused' },
		settings,
		exec,
		signal: new AbortController().signal,
		at
	});
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
		const v = r.value;
		assert.equal(v.schema, 'git-insights.v1');
		assert.equal(v.refreshMinutes, 60);
		assert.equal(v.defaultDays, 30);
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
		assert.ok(JSON.stringify(v).length < 256 * 1024);
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
		const first = await ask(plugin, exec, { settings });
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
		assert.equal(r.value.defaultDays, 7);
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
		assert.deepEqual(r, { available: false, reason: 'This project’s folder isn’t a git clone.' });
	});

	it('says plainly when the clone has no commits', async () => {
		const empty = makeRepo([]);
		try {
			const { exec } = makeExec(empty.dir);
			const r = await ask(createPlugin({ now: () => NOW }), exec);
			assert.deepEqual(r, { available: false, reason: 'This project’s clone has no commits yet.' });
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
