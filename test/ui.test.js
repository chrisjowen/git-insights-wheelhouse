import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { ignoreMatcher, parseGitHub, summarise } from '../wheelhouse/server/collect.js';
import { overview } from '../wheelhouse/server/overview.js';
import { DAY, githubAnswer } from './helpers.js';

const NOW = Date.now();
const window = new Window({ url: 'http://127.0.0.1:4310/plugins/git-insights/insights' });
let ui;

before(async () => {
	for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'location']) {
		globalThis[k] = k === 'window' ? window : window[k];
	}
	ui = await import('../wheelhouse/ui/index.js');
});
after(() => window.happyDOM.close());

const commit = (author, daysAgo, files, subject = `Work by ${author}`) => ({
	sha: Math.random().toString(16).slice(2, 12).padEnd(10, 'a'),
	author,
	at: NOW - daysAgo * DAY,
	subject,
	files: files.map((path) => ({ path, add: 3, del: 1 }))
});

/** A project's snapshot like the provider's, for a made-up project. */
function snapshot({ github = 'ok', commits: list } = {}) {
	const commits = list ?? [
		commit('Maya Okafor', 0.1, ['src/renderer/mod.rs'], 'Fix tone mapping'),
		commit('Tom Lindqvist', 1.5, ['src/cli/build.rs', 'src/renderer/mod.rs']),
		commit('Maya Okafor', 3, ['src/renderer/mod.rs']),
		commit('Priya Raman', 5, ['docs/guide.md']),
		commit('Sam Chen', 6, ['src/renderer/batch.rs']),
		commit('Ines Duarte', 8, ['ci/build.yml']),
		commit('Tom Lindqvist', 20, ['src/cli/watch.rs']),
		commit('Maya Okafor', 60, ['src/renderer/old.rs'])
	];
	const url =
		github === 'none' ? () => null : (sha) => `https://github.com/acme/lumen/commit/${sha}`;
	const periods = {};
	for (const days of [7, 30, 90]) {
		periods[days] = summarise(commits, {
			days,
			now: NOW,
			ignore: ignoreMatcher([]),
			before: new Set(['Maya Okafor']),
			commitUrl: url
		});
	}
	const gh =
		github === 'ok'
			? { state: 'ok', ...parseGitHub(githubAnswer(NOW).data, NOW) }
			: github === 'none'
				? { state: 'none' }
				: { state: 'failed', reason: 'GitHub took too long to answer.' };
	return {
		schema: 'git-insights.v1',
		collectedAt: NOW - 23 * 60_000,
		branch: 'main',
		repo: github === 'none' ? null : { name: 'acme/lumen', url: 'https://github.com/acme/lumen' },
		lastCommitAt: commits[0]?.at ?? null,
		periods,
		commits: commits.map((c) => ({
			subject: c.subject,
			author: c.author,
			bot: false,
			at: c.at,
			add: 3,
			del: 1,
			fileCount: c.files.length,
			files: c.files.map((f) => f.path),
			url: url(c.sha)
		})),
		github: gh,
		githubAt: github === 'ok' ? NOW - 23 * 60_000 : null
	};
}

/**
 * The page's value, as the provider makes it, for these projects: each a
 * snapshot, `{ failed: reason }` or null (not read yet), by id.
 */
function page(projects, { defaultDays = 30, refresh = {} } = {}) {
	const read = new Map();
	for (const [id, s] of Object.entries(projects)) {
		if (s === null) continue;
		read.set(
			id,
			s.failed
				? { snapshot: null, failed: { at: NOW, reason: s.failed } }
				: { snapshot: s, failed: refresh[id] ?? null }
		);
	}
	return overview(
		Object.keys(projects).map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
		read,
		{ refreshMinutes: 60, defaultDays }
	);
}

/** Go to an address on the page, as a link or the back button would. */
function go(hash) {
	window.location.hash = hash;
	window.dispatchEvent(new window.Event('hashchange'));
}

/** The page, at `hash`: `#project=<id>` for a project's own insights, '' for the overview. */
function mount(data, hash = '#project=lumen') {
	go(hash);
	const el = document.createElement('git-insights-page');
	document.body.append(el);
	el.data = data;
	return el;
}

/** A project's own insights, from one snapshot. */
const mountProject = (s, o = {}) => mount(page({ lumen: s }, o));

const text = (el) => el.shadowRoot.textContent.replace(/\s+/g, ' ');
const sections = (el) =>
	[...el.shadowRoot.querySelectorAll('section h2')].map((h) => h.textContent);

describe('a project’s own insights', () => {
	beforeEach(() => document.body.replaceChildren());

	it('sums the period up in a sentence, says how old it is, and lists each part', () => {
		const el = mountProject(snapshot());
		const t = text(el);
		assert.equal(el.shadowRoot.querySelector('.title h2').textContent, 'Lumen');
		assert.equal(
			el.shadowRoot.querySelector('.title a').getAttribute('href'),
			'https://github.com/acme/lumen'
		);
		const back = el.shadowRoot.querySelector('a.back');
		assert.equal(back.textContent, 'All projects');
		assert.equal(back.getAttribute('href'), '#');
		assert.match(
			t,
			/7 commits from 5 people in the last 30 days, 3 pull requests merged and 3 open\./
		);
		assert.match(t, /Updated 23 minutes ago · reads again every hour/);
		assert.deepEqual(sections(el), [
			'Open pull requests',
			'People',
			'Latest commits',
			'Hotspots',
			'Also'
		]);
		assert.match(t, /Waiting for review/);
		assert.match(t, /Checks failing/);
		assert.match(t, /Time to merge/);
		assert.match(t, /v0\.4\.2/);
	});

	it('opens in the period the settings name, and switches period', () => {
		const el = mountProject(snapshot(), { defaultDays: 7 });
		assert.match(text(el), /5 commits from 4 people in the last 7 days/);
		const ninety = [...el.shadowRoot.querySelectorAll('.seg button')].find(
			(b) => b.textContent === '90 days'
		);
		ninety.click();
		assert.match(text(el), /8 commits from 5 people in the last 90 days/);
		assert.equal(ninety.isConnected, false);
		const pressed = el.shadowRoot.querySelector('.seg button[aria-pressed="true"]');
		assert.equal(pressed.textContent, '90 days');
	});

	it('opens a row in place for its detail', () => {
		const el = mountProject(snapshot());
		const row = el.shadowRoot.querySelector('section[aria-label="Open pull requests"] .row');
		const button = row.querySelector('button');
		assert.equal(button.getAttribute('aria-expanded'), 'false');
		button.click();
		assert.ok(row.classList.contains('open'));
		assert.equal(button.getAttribute('aria-expanded'), 'true');
		assert.match(row.querySelector('.detail').textContent, /Sam Chen opened it 6 days ago/);
		const link = row.querySelector('.detail a');
		assert.equal(link.getAttribute('href'), 'https://github.com/acme/lumen/pull/216');
		assert.equal(link.getAttribute('target'), '_blank');
	});

	it('shows five rows until asked for all, and keeps open rows open when the data changes', () => {
		const el = mountProject(snapshot());
		const rows = () => el.shadowRoot.querySelectorAll('section[aria-label="Latest commits"] .row');
		assert.equal(rows().length, 5);
		rows()[0].querySelector('button').click();
		el.shadowRoot.querySelector('section[aria-label="Latest commits"] .more').click();
		assert.equal(rows().length, 8);
		const again = snapshot();
		again.commits = el.data.projects[0].detail.commits;
		el.data = page({ lumen: again });
		assert.ok(rows()[0].classList.contains('open'));
		assert.equal(rows().length, 8);
	});

	it('says plainly when there is no GitHub, and shows what the clone alone can tell', () => {
		const el = mountProject(snapshot({ github: 'none' }));
		const t = text(el);
		assert.match(t, /No GitHub here\./);
		assert.match(t, /Files changed/);
		assert.match(t, /Busiest day/);
		assert.ok(!sections(el).includes('Open pull requests'));
		assert.equal(el.shadowRoot.querySelectorAll('a:not(.back)').length, 0);
	});

	it('says why GitHub is missing when it failed', () => {
		const el = mountProject(snapshot({ github: 'failed' }));
		assert.match(text(el), /GitHub isn’t shown\. GitHub took too long to answer\./);
	});

	it('says when it could not read again and shows the older figures', () => {
		const data = snapshot();
		data.collectedAt = NOW - 3 * 3_600_000;
		const refresh = { lumen: { at: NOW, reason: 'Reading the history took too long.' } };
		assert.match(
			text(mountProject(data, { refresh })),
			/Couldn’t read it again just now\. Reading the history took too long\. This is what it read 3 hours ago/
		);
	});

	it('says so when nothing happened in the period', () => {
		const el = mountProject(
			snapshot({ github: 'none', commits: [commit('Maya Okafor', 60, ['a.md'])] })
		);
		const t = text(el);
		assert.match(t, /No commits in the last 30 days\./);
		assert.match(t, /Nobody has committed in the last 30 days\./);
	});

	it('shows text from the repository as text, and links only to http(s)', () => {
		const data = snapshot();
		data.commits[0].subject = '<img src=x onerror=alert(1)>';
		data.commits[0].url = 'javascript:alert(1)';
		data.github.openPrs[0].url = 'javascript:alert(2)';
		const el = mountProject(data);
		assert.equal(el.shadowRoot.querySelector('img'), null);
		assert.match(text(el), /<img src=x onerror=alert\(1\)>/);
		for (const a of el.shadowRoot.querySelectorAll('a:not(.back)')) {
			assert.match(a.getAttribute('href'), /^https:\/\//);
		}
	});

	it('draws nothing for a value it does not know', () => {
		const el = mount({ schema: 'something-else' });
		assert.equal(el.shadowRoot.querySelector('.gi'), null);
	});
});

describe('the page across projects', () => {
	beforeEach(() => document.body.replaceChildren());

	/** A second project with no GitHub, and its own people. */
	const atlas = () =>
		snapshot({
			github: 'none',
			commits: [
				commit('Maya Okafor', 1, ['lib/a.ts']),
				commit('Noor Haddad', 2, ['lib/b.ts']),
				commit('Noor Haddad', 40, ['lib/c.ts'])
			]
		});
	/** Each project's row, its cells' text separated by spaces. */
	const rows = (el) =>
		[...el.shadowRoot.querySelectorAll('section[aria-label="Projects"] .g-project')].map((r) =>
			[...r.children]
				.map((c) => c.textContent)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim()
		);

	it('sums every project up, then lists each with a link to its own insights', () => {
		const el = mount(
			page({
				atlas: atlas(),
				lumen: snapshot(),
				vega: { failed: 'This project has no clone to read.' }
			}),
			''
		);
		const t = text(el);
		// Maya committed to both and counts once.
		assert.match(
			t,
			/9 commits from 6 people across 2 projects in the last 30 days, 3 pull requests merged and 3 open\./
		);
		assert.match(t, /Updated 23 minutes ago · reads again every hour/);
		const figures = [...el.shadowRoot.querySelectorAll('.stat .k')].map((k) => k.textContent);
		assert.deepEqual(figures, ['Commits', 'Pull requests', 'Issues', 'Lines']);
		assert.deepEqual(sections(el), ['Projects']);

		// The busiest first; a project that could not be read last, with why, and no link.
		const links = [...el.shadowRoot.querySelectorAll('a.g-project')];
		assert.deepEqual(
			links.map((a) => a.getAttribute('href')),
			['#project=lumen', '#project=atlas']
		);
		const [lumen, second, vega] = rows(el);
		assert.match(
			rows(mount(page({ lumen: snapshot({ github: 'failed' }) }), ''))[0],
			/ GitHub not read /
		);
		assert.match(lumen, /^Lumen acme\/lumen 7 commits 5 people 3 open PRs last 2 hours ago/);
		assert.match(second, /^Atlas 2 commits 2 people no GitHub/);
		assert.equal(vega, 'Vega This project has no clone to read.');
	});

	it('switches period for the totals and the rows', () => {
		const el = mount(page({ atlas: atlas(), lumen: snapshot() }), '');
		[...el.shadowRoot.querySelectorAll('.seg button')]
			.find((b) => b.textContent === '90 days')
			.click();
		assert.match(text(el), /11 commits from 6 people across 2 projects in the last 90 days/);
		assert.match(rows(el)[1], /^Atlas 3 commits/);
	});

	it('opens a project from its row, and goes back to every project', () => {
		const el = mount(page({ atlas: atlas(), lumen: snapshot() }), '');
		go(el.shadowRoot.querySelector('a.g-project').getAttribute('href'));
		assert.equal(el.shadowRoot.querySelector('.title h2').textContent, 'Lumen');
		assert.deepEqual(sections(el), [
			'Open pull requests',
			'People',
			'Latest commits',
			'Hotspots',
			'Also'
		]);
		go(el.shadowRoot.querySelector('a.back').getAttribute('href'));
		assert.deepEqual(sections(el), ['Projects']);
	});

	it('keeps what is open in one project to that project', () => {
		const el = mount(page({ atlas: atlas(), lumen: snapshot() }));
		el.shadowRoot.querySelector('section[aria-label="People"] .row button').click();
		go('#project=atlas');
		assert.equal(el.shadowRoot.querySelector('section[aria-label="People"] .row.open'), null);
		go('#project=lumen');
		assert.ok(el.shadowRoot.querySelector('section[aria-label="People"] .row.open'));
	});

	it('says what it can for a project not read yet, unknown, or with its detail left out', () => {
		const data = page({ lumen: snapshot(), atlas: null });
		assert.match(text(mount(data, '#project=atlas')), /It hasn’t been read yet/);
		assert.match(text(mount(data, '#project=nope')), /Git insights has no such project/);
		const trimmed = structuredClone(data);
		trimmed.projects[0].trimmed = 'some';
		assert.match(text(mount(trimmed)), /Some detail is left out\./);
		trimmed.projects[0].trimmed = 'all';
		trimmed.projects[0].detail = null;
		assert.match(text(mount(trimmed)), /too many projects to show this one’s detail here/);
		assert.match(rows(mount(data, ''))[1], /^Atlas Not read yet/);
	});

	it('is only a page in the menu now, not a tab on the project page', () => {
		assert.ok(customElements.get('git-insights-page'));
		assert.equal(customElements.get('git-insights-tab'), undefined);
	});

	it('reads the project from the address', () => {
		assert.equal(ui.projectFromHash('#project=lumen'), 'lumen');
		assert.equal(ui.projectFromHash('#project=a%20b%2Fc'), 'a b/c');
		assert.equal(ui.projectFromHash('#'), null);
		assert.equal(ui.projectFromHash(''), null);
	});
});

describe('words', () => {
	it('says how long ago', () => {
		assert.equal(ui.ago(NOW - 20_000, NOW), 'just now');
		assert.equal(ui.ago(NOW - 60_000, NOW), '1 minute ago');
		assert.equal(ui.ago(NOW - 3 * 3_600_000, NOW), '3 hours ago');
		assert.equal(ui.ago(NOW - 1.2 * DAY, NOW), 'yesterday');
		assert.equal(ui.ago(NOW - 20 * DAY, NOW), '3 weeks ago');
	});

	it('says how long merging takes', () => {
		assert.equal(ui.duration(null), null);
		assert.equal(ui.duration(0.25), '15 minutes');
		assert.equal(ui.duration(5), '5 hours');
		assert.equal(ui.duration(43.2), '1.8 days');
		assert.equal(ui.duration(48), '2 days');
	});

	it('keeps links to http(s)', () => {
		assert.equal(ui.safeUrl('https://github.com/a/b'), 'https://github.com/a/b');
		assert.equal(ui.safeUrl('javascript:alert(1)'), null);
		assert.equal(ui.safeUrl('not a url'), null);
	});
});
