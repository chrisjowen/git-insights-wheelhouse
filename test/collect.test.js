import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	areaOf,
	clean,
	githubArgs,
	githubReason,
	githubRepo,
	ignoreMatcher,
	parseGitHub,
	parseLog,
	parseShortlog,
	summarise
} from '../wheelhouse/server/collect.js';
import { DAY, githubAnswer } from './helpers.js';

const NOW = Date.UTC(2026, 9, 31, 12);

describe('githubRepo', () => {
	it('reads owner/repo from https and ssh remotes', () => {
		assert.equal(githubRepo('https://github.com/acme/lumen.git\n'), 'acme/lumen');
		assert.equal(githubRepo('https://github.com/acme/lumen'), 'acme/lumen');
		assert.equal(githubRepo('git@github.com:acme/lumen.git'), 'acme/lumen');
		assert.equal(githubRepo('ssh://git@github.com/acme/lumen.git'), 'acme/lumen');
	});

	it('says null for anything not on GitHub', () => {
		assert.equal(githubRepo('https://gitlab.com/acme/lumen.git'), null);
		assert.equal(githubRepo('/srv/git/lumen.git'), null);
		assert.equal(githubRepo(''), null);
	});
});

describe('parseLog', () => {
	it('reads commits with their files, binary files having no line counts', () => {
		const out =
			'\x1eabc1234def\x1fMaya Okafor\x1f1793000000\x1fFix tone\x1fmapping\n\n3\t1\tsrc/a.rs\n-\t-\timg/logo.png\n' +
			'\x1e0123456789\x1fTom\x1f1792990000\x1fAdd flag\n\n10\t0\tREADME.md\n';
		const commits = parseLog(out);
		assert.equal(commits.length, 2);
		assert.deepEqual(commits[0], {
			sha: 'abc1234def',
			author: 'Maya Okafor',
			at: 1793000000000,
			// A separator inside the subject becomes a space.
			subject: 'Fix tone mapping',
			files: [
				{ path: 'src/a.rs', add: 3, del: 1 },
				{ path: 'img/logo.png', add: null, del: null }
			]
		});
		assert.equal(commits[1].files[0].add, 10);
	});

	it('skips anything that is not a commit', () => {
		assert.deepEqual(parseLog(''), []);
		assert.deepEqual(parseLog('\x1enot-a-sha\x1fx\x1f1\x1fy\n'), []);
	});
});

describe('clean', () => {
	it('makes one line of plain text and shortens long ones', () => {
		assert.equal(clean('a\nb\tc\u0007'), 'a b c');
		assert.equal(clean('x'.repeat(300)).length, 200);
	});
});

describe('parseShortlog', () => {
	it('reads the names', () => {
		assert.deepEqual(
			[...parseShortlog('    12\tMaya Okafor\n     1\tTom\n')],
			['Maya Okafor', 'Tom']
		);
	});
});

describe('ignoreMatcher', () => {
	const ignore = ignoreMatcher(['package-lock.json', '*.min.js', 'dist/', 'docs/generated/api.md']);
	it('matches file names anywhere, wildcards, folders and paths', () => {
		assert.ok(ignore('package-lock.json'));
		assert.ok(ignore('web/package-lock.json'));
		assert.ok(ignore('static/app.min.js'));
		assert.ok(ignore('dist/index.js'));
		assert.ok(ignore('web/dist/index.js'));
		assert.ok(ignore('docs/generated/api.md'));
	});
	it('leaves the rest', () => {
		assert.ok(!ignore('src/app.js'));
		assert.ok(!ignore('distance.js'));
		assert.ok(!ignore('api.md'));
	});
	it('ignores nothing without patterns', () => {
		assert.ok(!ignoreMatcher(undefined)('package-lock.json'));
	});
});

describe('areaOf', () => {
	it('names the folder a file is in, looking inside container folders', () => {
		assert.equal(areaOf('docs/guide.md'), 'docs');
		assert.equal(areaOf('src/renderer/mod.rs'), 'renderer');
		assert.equal(areaOf('src/main.rs'), 'src');
		assert.equal(areaOf('README.md'), null);
	});
});

describe('summarise', () => {
	const commit = (author, daysAgo, files, subject = 'work') => ({
		sha: `${author}${daysAgo}`.padEnd(8, '0').replace(/[^0-9a-f]/g, 'a'),
		author,
		at: NOW - daysAgo * DAY + 1000,
		subject,
		files: Object.entries(files).map(([path, [add, del]]) => ({ path, add, del }))
	});
	const commits = [
		commit('Maya', 1, { 'src/renderer/mod.rs': [10, 2], 'Cargo.lock': [40, 40] }),
		commit('Tom', 2, { 'src/renderer/mod.rs': [5, 5], 'src/cli/build.rs': [7, 0] }),
		commit('Maya', 3, { 'src/renderer/mod.rs': [1, 1] }),
		commit('dependabot[bot]', 4, { 'Cargo.lock': [2, 2] }),
		commit('Ines', 20, { 'docs/guide.md': [100, 0] })
	];
	const opts = {
		now: NOW,
		ignore: ignoreMatcher(['Cargo.lock']),
		before: new Set(['Maya', 'Tom']),
		commitUrl: (s) => `https://github.com/acme/lumen/commit/${s}`
	};

	it('counts only the commits in the period', () => {
		const week = summarise(commits, { ...opts, days: 7 });
		assert.equal(week.commits, 4);
		assert.equal(week.authors, 3);
		assert.equal(week.add, 10 + 40 + 5 + 7 + 1 + 2);
		assert.equal(week.cadence.unit, 'day');
		assert.equal(week.cadence.counts.length, 7);
		// The last bucket is the last 24 hours.
		assert.deepEqual(week.cadence.counts, [0, 0, 0, 1, 1, 1, 1]);
	});

	it('ranks people by commits, with their areas, activity and recent commits', () => {
		const [maya, tom, bot] = summarise(commits, { ...opts, days: 7 }).people;
		assert.equal(maya.name, 'Maya');
		assert.equal(maya.commits, 2);
		assert.deepEqual(maya.areas, ['renderer']);
		assert.equal(maya.recent[0].url, `https://github.com/acme/lumen/commit/${commits[0].sha}`);
		assert.equal(
			maya.spark.reduce((a, b) => a + b),
			2
		);
		assert.equal(tom.name, 'Tom');
		assert.equal(bot.bot, true);
	});

	it('finds hotspots, leaving out ignored files, with who touches them', () => {
		const { hotspots } = summarise(commits, { ...opts, days: 7 });
		assert.equal(hotspots[0].file, 'src/renderer/mod.rs');
		assert.equal(hotspots[0].changes, 3);
		assert.deepEqual(hotspots[0].people, ['Maya', 'Tom']);
		assert.ok(!hotspots.some((x) => x.file === 'Cargo.lock'));
	});

	it('counts weeks over 90 days, and names new people who are not bots', () => {
		const quarter = summarise(commits, { ...opts, days: 90 });
		assert.equal(quarter.cadence.unit, 'week');
		assert.equal(quarter.cadence.counts.length, 13);
		assert.equal(quarter.commits, 5);
		assert.deepEqual(quarter.newPeople, ['Ines']);
	});

	it('names nobody new when the history starts inside the period, or is unknown', () => {
		assert.deepEqual(summarise(commits, { ...opts, days: 90, before: new Set() }).newPeople, []);
		assert.deepEqual(summarise(commits, { ...opts, days: 90, before: null }).newPeople, []);
	});

	it('says what is busiest', () => {
		const p = summarise(commits, { ...opts, days: 30 });
		assert.ok(p.busiestDay.name);
		assert.equal(summarise([], { ...opts, days: 30 }).busiestDay, null);
	});
});

describe('parseGitHub', () => {
	const gh = parseGitHub(githubAnswer(NOW).data, NOW);

	it('describes each open pull request in plain words', () => {
		assert.equal(gh.openPrCount, 3);
		const [first, second, third] = gh.openPrs;
		assert.equal(first.author, 'Sam Chen');
		assert.equal(first.reviewText, 'Waiting for review');
		assert.equal(first.checksText, 'Checks passing');
		assert.deepEqual(first.reviewers, ['Maya Okafor']);
		assert.equal(second.author, 'ines');
		assert.equal(second.review, 'changes');
		assert.equal(second.checks, 'failing');
		assert.equal(third.bot, true);
		assert.equal(third.checksText, 'No checks');
	});

	it('counts merges and the typical time to merge per period', () => {
		assert.equal(gh.periods[7].merged, 2);
		assert.equal(gh.periods[7].medianMergeHours, 24);
		assert.equal(gh.periods[30].mergeSample, 3);
		assert.equal(gh.periods[90].issuesClosed, 11);
	});

	it('keeps published releases only, and only GitHub links', () => {
		assert.deepEqual(
			gh.releases.map((r) => r.tag),
			['v0.4.2']
		);
		const odd = githubAnswer(NOW);
		odd.data.repository.pullRequests.nodes[0].url = 'javascript:alert(1)';
		assert.equal(parseGitHub(odd.data, NOW).openPrs[0].url, null);
	});

	it('refuses an answer without a repository', () => {
		assert.throws(() => parseGitHub({}, NOW));
	});
});

describe('githubArgs', () => {
	it('asks one read-only query, with the dates in the searches', () => {
		const args = githubArgs('acme/lumen', NOW);
		assert.deepEqual(args.slice(0, 3), ['gh', 'api', 'graphql']);
		const query = args.find((a) => a.startsWith('query='));
		assert.match(query, /^query=query\(/);
		assert.doesNotMatch(query, /mutation/);
		assert.ok(
			args.includes('m30=repo:acme/lumen is:pr is:merged merged:>=2026-10-01 sort:created-desc')
		);
	});
});

describe('githubReason', () => {
	it('explains common failures without raw output', () => {
		assert.match(githubReason({ reason: 'spawn gh ENOENT' }), /isn't installed/);
		assert.match(
			githubReason({ stderr: 'To get started with GitHub CLI, please run:  gh auth login' }),
			/signed in/
		);
		assert.match(githubReason({ reason: 'timed out after 9000 ms' }), /too long/);
		assert.match(
			githubReason({ stderr: 'Could not resolve to a Repository with the name' }),
			/doesn’t exist/
		);
		assert.equal(githubReason({ stderr: 'weird' }), 'GitHub couldn’t be read just now.');
	});
});
