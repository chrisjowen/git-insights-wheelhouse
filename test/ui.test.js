import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { ignoreMatcher, parseGitHub, summarise } from '../wheelhouse/server/collect.js';
import { DAY, githubAnswer } from './helpers.js';

const NOW = Date.now();
const window = new Window({ url: 'http://127.0.0.1:4310/projects/lumen/git-insights/insights' });
let ui;

before(async () => {
	for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node']) {
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

/** A snapshot like the provider's, for a made-up project. */
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
		githubAt: github === 'ok' ? NOW - 23 * 60_000 : null,
		refreshMinutes: 60,
		defaultDays: 30,
		refresh: null
	};
}

function mount(data) {
	const el = document.createElement('git-insights-tab');
	document.body.append(el);
	el.data = data;
	return el;
}

const text = (el) => el.shadowRoot.textContent.replace(/\s+/g, ' ');
const sections = (el) =>
	[...el.shadowRoot.querySelectorAll('section h2')].map((h) => h.textContent);

describe('the Insights tab', () => {
	beforeEach(() => document.body.replaceChildren());

	it('sums the period up in a sentence, says how old it is, and lists each part', () => {
		const el = mount(snapshot());
		const t = text(el);
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
		const data = snapshot();
		data.defaultDays = 7;
		const el = mount(data);
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
		const el = mount(snapshot());
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
		const el = mount(snapshot());
		const rows = () => el.shadowRoot.querySelectorAll('section[aria-label="Latest commits"] .row');
		assert.equal(rows().length, 5);
		rows()[0].querySelector('button').click();
		el.shadowRoot.querySelector('section[aria-label="Latest commits"] .more').click();
		assert.equal(rows().length, 8);
		const again = snapshot();
		again.commits = el.data.commits;
		el.data = again;
		assert.ok(rows()[0].classList.contains('open'));
		assert.equal(rows().length, 8);
	});

	it('says plainly when there is no GitHub, and shows what the clone alone can tell', () => {
		const el = mount(snapshot({ github: 'none' }));
		const t = text(el);
		assert.match(t, /No GitHub here\./);
		assert.match(t, /Files changed/);
		assert.match(t, /Busiest day/);
		assert.ok(!sections(el).includes('Open pull requests'));
		assert.equal(el.shadowRoot.querySelectorAll('a').length, 0);
	});

	it('says why GitHub is missing when it failed', () => {
		const el = mount(snapshot({ github: 'failed' }));
		assert.match(text(el), /GitHub isn’t shown\. GitHub took too long to answer\./);
	});

	it('says when it could not read again and shows the older figures', () => {
		const data = snapshot();
		data.refresh = { failedAt: NOW, reason: 'Reading the history took too long.' };
		data.collectedAt = NOW - 3 * 3_600_000;
		assert.match(
			text(mount(data)),
			/Couldn’t read it again just now\. Reading the history took too long\. This is what it read 3 hours ago/
		);
	});

	it('says so when nothing happened in the period', () => {
		const el = mount(snapshot({ github: 'none', commits: [commit('Maya Okafor', 60, ['a.md'])] }));
		const t = text(el);
		assert.match(t, /No commits in the last 30 days\./);
		assert.match(t, /Nobody has committed in the last 30 days\./);
	});

	it('shows text from the repository as text, and links only to http(s)', () => {
		const data = snapshot();
		data.commits[0].subject = '<img src=x onerror=alert(1)>';
		data.commits[0].url = 'javascript:alert(1)';
		data.github.openPrs[0].url = 'javascript:alert(2)';
		const el = mount(data);
		assert.equal(el.shadowRoot.querySelector('img'), null);
		assert.match(text(el), /<img src=x onerror=alert\(1\)>/);
		for (const a of el.shadowRoot.querySelectorAll('a')) {
			assert.match(a.getAttribute('href'), /^https:\/\//);
		}
	});

	it('draws nothing for a value it does not know', () => {
		const el = mount({ schema: 'something-else' });
		assert.equal(el.shadowRoot.querySelector('.gi'), null);
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
