/**
 * The Insights tab as a custom element. Wheelhouse imports this bundle, then
 * sets the provider's snapshot on the element as `data` each time it changes.
 * One calm column: a sentence that sums the period up, four figures, then open
 * pull requests, people, latest commits and hotspots, each row opening in
 * place for more. It builds its DOM with textContent only, keeps links to
 * http(s), and styles itself with Wheelhouse's CSS variables, so it follows the
 * light and dark themes.
 *
 * @typedef {import('../server/types.js').TabData} TabData
 */

const PERIODS = [7, 30, 90];
const ROWS = 5;
const TONES = 6;

const STYLE = `
:host { display: block; flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; container-type: inline-size; color: var(--foreground); font: inherit; font-size: 0.875rem; line-height: 1.5; }
:host::-webkit-scrollbar { display: none; }
.gi { max-width: 72rem; padding: 1.5rem 1.5rem 3rem; }
@container (max-width: 640px) { .gi { padding: 1rem 1rem 2.5rem; } }
* { box-sizing: border-box; }
a { color: var(--sea); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--ring, var(--sea)); outline-offset: 2px; border-radius: 4px; }
.num { font-variant-numeric: tabular-nums; }
.dim { color: var(--muted-foreground); }
.small { font-size: 0.75rem; }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.add { color: var(--success); }
.del { color: var(--danger); }

.top { display: flex; align-items: center; gap: 0.75rem 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.pulse { font-family: var(--font-display); font-size: 1.375rem; line-height: 1.35; margin: 0; flex: 1 1 32rem; font-weight: 400; }
.pulse em { font-style: normal; color: var(--sea); }
.meta { display: flex; align-items: center; gap: 0.625rem; font-size: 0.75rem; color: var(--muted-foreground); flex-wrap: wrap; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 2px; background: var(--card); }
.seg button { border: 0; background: transparent; padding: 0.2rem 0.65rem; border-radius: 999px; font-size: 0.75rem; color: var(--muted-foreground); }
.seg button[aria-pressed='true'] { background: var(--accent); color: var(--foreground); }

.note { border: 1px solid var(--border); border-left: 3px solid var(--brass); background: var(--panel, var(--card)); border-radius: var(--radius); padding: 0.625rem 0.875rem; font-size: 0.8125rem; color: var(--muted-foreground); margin-bottom: 1.25rem; }
.note strong { color: var(--foreground); font-weight: 500; }

.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); margin-bottom: 1.75rem; }
.stat { padding: 0.875rem 1rem; border-left: 1px solid var(--border); min-width: 0; }
.stat:first-child { border-left: 0; }
.k { font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted-foreground); }
.stat .v { font-family: var(--font-display); font-size: 1.75rem; line-height: 1.15; margin-top: 2px; }
.stat .s { font-size: 0.75rem; color: var(--muted-foreground); }
.stat svg { display: block; margin-top: 0.375rem; width: 100%; height: 22px; }
@container (max-width: 720px) {
	.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.stat:nth-child(3) { border-left: 0; }
	.stat:nth-child(n + 3) { border-top: 1px solid var(--border); }
}

section { margin-bottom: 2rem; }
.sec-h { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.5rem; }
.sec-h h2 { font-family: var(--font-display); font-weight: 400; font-size: 1.25rem; margin: 0; }
.sec-h span { font-size: 0.75rem; color: var(--muted-foreground); }
.empty { color: var(--muted-foreground); padding: 0.625rem 0.25rem; border-top: 1px solid var(--hair, var(--border)); }

.list { border-top: 1px solid var(--hair, var(--border)); }
.row { border-bottom: 1px solid var(--hair, var(--border)); }
.rh { all: unset; box-sizing: border-box; width: 100%; display: grid; align-items: center; gap: 0.75rem; padding: 0.625rem 0.25rem; cursor: pointer; border-radius: 4px; }
.rh:hover { background: var(--accent); }
.rh:focus-visible { outline: 2px solid var(--ring, var(--sea)); outline-offset: 1px; }
.chev { width: 14px; height: 14px; color: var(--muted-foreground); transition: transform 0.18s ease-out; }
.row.open .chev { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
.detail { display: none; padding: 0.25rem 0.25rem 0.875rem 1.875rem; font-size: 0.8125rem; color: var(--muted-foreground); }
.row.open .detail { display: block; }
.detail ul { margin: 0.375rem 0 0; padding: 0; list-style: none; }
.detail li { padding: 0.15rem 0; display: flex; gap: 0.625rem; min-width: 0; }
.detail li .w { margin-left: auto; white-space: nowrap; }
.detail p { margin: 0 0 0.25rem; }
.more { all: unset; cursor: pointer; color: var(--sea); font-size: 0.75rem; padding: 0.5rem 0.25rem; }
.more:hover { text-decoration: underline; }

.who { display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
.av { width: 26px; height: 26px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 0.6875rem; font-weight: 600; flex: none; }
.stack { display: flex; }
.stack .av { box-shadow: 0 0 0 2px var(--background); }
.stack .av + .av { margin-left: -3px; }
.t0 { color: var(--sea); background: color-mix(in srgb, var(--sea) 16%, transparent); }
.t1 { color: var(--brass); background: color-mix(in srgb, var(--brass) 18%, transparent); }
.t2 { color: var(--success); background: color-mix(in srgb, var(--success) 16%, transparent); }
.t3 { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
.t4 { color: var(--amber); background: color-mix(in srgb, var(--amber) 18%, transparent); }
.t5 { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 10%, transparent); }
.tag { font-size: 0.6875rem; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: 999px; padding: 0 0.4rem; margin-left: 0.375rem; }

.pill { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; white-space: nowrap; }
.pill i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--hair, var(--border)); }
.pill.good i { background: var(--success); }
.pill.bad i { background: var(--danger); }
.pill.wait i { background: var(--amber); }
.bar { height: 6px; border-radius: 3px; background: var(--muted); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--sea); opacity: 0.7; }
.right { text-align: right; }

.g-pr { grid-template-columns: 14px minmax(0, 1fr) 9rem 8.5rem 4.5rem; }
.g-person { grid-template-columns: 14px minmax(0, 1.4fr) 5.5rem minmax(0, 1fr) 90px 6.5rem; }
.g-commit { grid-template-columns: 14px minmax(0, 1fr) minmax(0, 10rem) 5.5rem 6.5rem; }
.g-hot { grid-template-columns: 14px minmax(0, 1fr) 7rem 7.5rem 5.5rem; }
@container (max-width: 720px) {
	.g-pr, .g-commit, .g-hot { grid-template-columns: 14px minmax(0, 1fr) 5.5rem; }
	.g-person { grid-template-columns: 14px minmax(0, 1fr) 4.5rem 5.5rem; }
	.wide { display: none; }
}

.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
.fact { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.75rem 0.875rem; min-width: 0; }
.fact .v { font-size: 0.9375rem; margin-top: 2px; }
@container (max-width: 720px) { .facts { grid-template-columns: minmax(0, 1fr); } }
`;

const SVG = 'http://www.w3.org/2000/svg';

/** Only http(s) links, as Wheelhouse's own blocks allow. */
export function safeUrl(href) {
	try {
		const u = new URL(href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
}

/** An element with a class, attributes and children (strings become text, never markup). */
function h(tag, props = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'onclick') el.addEventListener('click', v);
		else el.setAttribute(k, String(v));
	}
	append(el, children);
	return el;
}

function append(el, children) {
	for (const c of children.flat(Infinity)) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

function svg(tag, attrs = {}, ...children) {
	const el = document.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	for (const c of children) el.append(c);
	return el;
}

function link(href, text, cls) {
	const url = safeUrl(href);
	if (!url) return h('span', { class: cls }, text);
	return h('a', { href: url, target: '_blank', rel: 'noreferrer', class: cls }, text);
}

const chevron = () =>
	svg(
		'svg',
		{
			class: 'chev',
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-width': 2,
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'aria-hidden': 'true'
		},
		svg('path', { d: 'm9 18 6-6-6-6' })
	);

// --- words ---

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** How long ago `at` was, in words. */
export function ago(at, now) {
	if (!at) return 'never';
	const m = Math.max(0, Math.round((now - at) / 60_000));
	if (m < 1) return 'just now';
	if (m < 60) return `${plural(m, 'minute')} ago`;
	const hrs = Math.round(m / 60);
	if (hrs < 24) return `${plural(hrs, 'hour')} ago`;
	const d = Math.round(hrs / 24);
	if (d === 1) return 'yesterday';
	if (d < 14) return `${d} days ago`;
	if (d < 60) return `${Math.round(d / 7)} weeks ago`;
	if (d < 365) return `${Math.round(d / 30)} months ago`;
	return `${plural(Math.round(d / 365), 'year')} ago`;
}

/** A span of hours in words, e.g. "40 minutes", "5 hours", "1.8 days". */
export function duration(hours) {
	if (hours === null || hours === undefined) return null;
	if (hours < 1) return plural(Math.max(1, Math.round(hours * 60)), 'minute');
	if (hours < 36) return plural(Math.round(hours), 'hour');
	const d = hours / 24;
	return `${d < 10 ? d.toFixed(1).replace(/\.0$/, '') : Math.round(d)} days`;
}

const age = (at, now) => {
	const d = Math.floor((now - at) / 86_400_000);
	if (d < 1) return 'today';
	return plural(d, 'day');
};

const every = (minutes) =>
	minutes === 60
		? 'every hour'
		: minutes % 60 === 0
			? `every ${minutes / 60} hours`
			: `every ${minutes} minutes`;

const short = (n) =>
	n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString('en');

const tone = (name) => [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES;
const initials = (name) =>
	name
		.replace(/\[bot\]$/i, '')
		.split(/[\s._-]+/)
		.filter(Boolean)
		.map((w) => w[0])
		.slice(0, 2)
		.join('')
		.toUpperCase() || '?';
const avatar = (name) =>
	h('span', { class: `av t${tone(name)}`, 'aria-hidden': 'true' }, initials(name));

function fileName(path) {
	const i = path.lastIndexOf('/');
	const name = i < 0 ? path : path.slice(i + 1);
	const dir = i < 0 ? '' : path.slice(0, i);
	return h(
		'span',
		{ class: 'ell', title: path },
		name,
		dir ? h('span', { class: 'dim small' }, ' ', dir) : null
	);
}

function bars(counts, label) {
	const max = Math.max(1, ...counts);
	const w = 100 / counts.length;
	return svg(
		'svg',
		{ viewBox: '0 0 100 22', preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
		...counts.map((v, i) =>
			svg('rect', {
				x: (i * w + w * 0.18).toFixed(2),
				y: (22 - Math.max(0.6, (v / max) * 22)).toFixed(2),
				width: (w * 0.64).toFixed(2),
				height: Math.max(0.6, (v / max) * 22).toFixed(2),
				rx: 0.6,
				fill: 'var(--sea)',
				opacity: v ? 0.75 : 0.25
			})
		)
	);
}

function spark(values) {
	const max = Math.max(1, ...values);
	const n = Math.max(1, values.length - 1);
	const points = values
		.map((v, i) => `${((i / n) * 88 + 1).toFixed(1)},${(17 - (v / max) * 15).toFixed(1)}`)
		.join(' ');
	return svg(
		'svg',
		{ viewBox: '0 0 90 18', width: 90, height: 18, 'aria-hidden': 'true' },
		svg('polyline', {
			points,
			fill: 'none',
			stroke: 'var(--sea)',
			'stroke-width': 1.4,
			'stroke-linejoin': 'round'
		})
	);
}

const REVIEW_TONE = { approved: 'good', changes: 'bad', waiting: 'wait', draft: '' };
const CHECK_TONE = { passing: 'good', failing: 'bad', running: 'wait', none: '' };
const pill = (cls, text) =>
	h('span', { class: `pill ${cls}` }, h('i', { 'aria-hidden': 'true' }), text);

class GitInsightsTab extends HTMLElement {
	/** @type {TabData | null} */
	#data = null;
	#period = null;
	#open = new Set();
	#all = new Set();
	#timer = null;

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	/** @param {TabData} value */
	set data(value) {
		this.#data = value && value.schema === 'git-insights.v1' ? value : null;
		this.render();
	}

	get data() {
		return this.#data;
	}

	connectedCallback() {
		this.render();
		// Keeps "Updated … ago" true while the tab stays open.
		this.#timer = setInterval(() => this.#tick(), 60_000);
	}

	disconnectedCallback() {
		clearInterval(this.#timer);
		this.#timer = null;
	}

	#tick() {
		const el = this.shadowRoot?.querySelector('[data-updated]');
		if (el && this.#data) el.textContent = this.#updated(this.#data, Date.now());
	}

	get #days() {
		const d = this.#period ?? this.#data?.defaultDays ?? 30;
		return PERIODS.includes(d) ? d : 30;
	}

	render() {
		if (!this.shadowRoot) return;
		const style = h('style', {}, STYLE);
		const d = this.#data;
		if (!d) {
			this.shadowRoot.replaceChildren(style);
			return;
		}
		const now = Date.now();
		const period = d.periods[this.#days];
		const gh = d.github.state === 'ok' || d.github.state === 'stale' ? d.github : null;
		const root = h(
			'div',
			{ class: 'gi' },
			h('div', { class: 'top' }, this.#pulse(period, gh), this.#meta(d, now)),
			this.#notes(d, now),
			this.#stats(period, gh),
			gh
				? this.#section(
						'Open pull requests',
						'waiting longest first',
						this.#prs(gh, now),
						'No open pull requests.'
					)
				: null,
			this.#section(
				'People',
				'who has been busy',
				this.#people(period, now),
				`Nobody has committed in the last ${this.#days} days.`
			),
			this.#section(
				'Latest commits',
				d.branch ? `on ${d.branch}` : '',
				this.#commits(d, now),
				'No commits in the last 90 days.'
			),
			this.#section(
				'Hotspots',
				'files changed most often',
				this.#hotspots(period, now),
				`No files changed in the last ${this.#days} days.`
			),
			this.#facts(d, period, gh, now)
		);
		this.shadowRoot.replaceChildren(style, root);
	}

	#pulse(p, gh) {
		const span = `in the last ${this.#days} days`;
		if (!p.commits) return h('p', { class: 'pulse' }, `No commits ${span}.`);
		const merged = gh?.periods[this.#days]?.merged;
		return h(
			'p',
			{ class: 'pulse' },
			h('em', {}, plural(p.commits, 'commit')),
			` from ${plural(p.authors, 'person', 'people')} ${span}`,
			gh && merged !== undefined
				? [
						', ',
						h('em', {}, `${plural(merged, 'pull request')} merged`),
						` and ${gh.openPrCount.toLocaleString('en')} open`
					]
				: null,
			'.'
		);
	}

	#updated(d, now) {
		return `Updated ${ago(d.collectedAt, now)} · reads again ${every(d.refreshMinutes)}`;
	}

	#meta(d, now) {
		const seg = h(
			'div',
			{ class: 'seg', role: 'group', 'aria-label': 'Period' },
			PERIODS.map((p) =>
				h(
					'button',
					{
						type: 'button',
						'aria-pressed': p === this.#days ? 'true' : 'false',
						onclick: () => {
							this.#period = p;
							this.render();
						}
					},
					`${p} days`
				)
			)
		);
		return h(
			'div',
			{ class: 'meta' },
			seg,
			h('span', { 'data-updated': '' }, this.#updated(d, now))
		);
	}

	#notes(d, now) {
		const notes = [];
		if (d.refresh) {
			notes.push(
				h(
					'div',
					{ class: 'note', role: 'status' },
					h('strong', {}, 'Couldn’t read it again just now. '),
					`${d.refresh.reason} This is what it read ${ago(d.collectedAt, now)}; it will try again in a few minutes.`
				)
			);
		}
		if (d.github.state === 'none') {
			notes.push(
				h(
					'div',
					{ class: 'note' },
					h('strong', {}, 'No GitHub here. '),
					'This project’s clone doesn’t point at a GitHub repository, so pull requests, issues and releases aren’t shown. Everything else comes from the clone itself.'
				)
			);
		} else if (d.github.state === 'failed') {
			notes.push(
				h(
					'div',
					{ class: 'note' },
					h('strong', {}, 'GitHub isn’t shown. '),
					`${d.github.reason} The history below comes from the clone itself.`
				)
			);
		} else if (d.github.state === 'stale') {
			notes.push(
				h(
					'div',
					{ class: 'note' },
					h('strong', {}, 'GitHub is out of date. '),
					`${d.github.reason} Pull requests, issues and releases are as GitHub had them ${ago(d.githubAt, now)}.`
				)
			);
		}
		return notes;
	}

	#stats(p, gh) {
		const unit = p.cadence.unit === 'week' ? 'week' : 'day';
		const cells = [
			{
				k: 'Commits',
				v: short(p.commits),
				s: plural(p.authors, 'person', 'people'),
				chart: bars(p.cadence.counts, `Commits per ${unit}`)
			}
		];
		const g = gh?.periods[this.#days];
		if (gh && g) {
			const merge = duration(g.medianMergeHours);
			cells.push(
				{
					k: 'Pull requests',
					v: short(gh.openPrCount),
					s: `open · ${g.merged.toLocaleString('en')} merged`
				},
				{
					k: 'Time to merge',
					v: merge ?? '—',
					s: merge ? `typical, from ${plural(g.mergeSample, 'merge')}` : 'nothing merged yet'
				},
				{
					k: 'Issues',
					v: gh.openIssues === null ? '—' : short(gh.openIssues),
					s:
						g.issuesOpened === null
							? 'open'
							: `open · ${g.issuesOpened.toLocaleString('en')} new, ${(g.issuesClosed ?? 0).toLocaleString('en')} closed`
				}
			);
		} else {
			cells.push(
				{ k: 'Files changed', v: short(p.filesChanged), s: `in the last ${this.#days} days` },
				{ k: 'Lines', v: `+${short(p.add)}`, s: `−${short(p.del)} removed` },
				{
					k: 'Busiest day',
					v: p.busiestDay?.name ?? '—',
					s: p.busiestDay ? `${Math.round(p.busiestDay.share * 100)}% of commits` : 'no commits yet'
				}
			);
		}
		return h(
			'div',
			{ class: 'stats' },
			cells.map((c) =>
				h(
					'div',
					{ class: 'stat' },
					h('div', { class: 'k' }, c.k),
					h('div', { class: 'v num' }, c.v),
					h('div', { class: 's' }, c.s),
					c.chart ?? null
				)
			)
		);
	}

	#section(title, sub, body, empty) {
		return h(
			'section',
			{ 'aria-label': title },
			h('div', { class: 'sec-h' }, h('h2', {}, title), sub ? h('span', {}, sub) : null),
			body ?? h('div', { class: 'empty' }, empty)
		);
	}

	/** A list of rows that open in place, five shown until "Show all". */
	#list(name, items, key, row) {
		if (!items.length) return null;
		const all = this.#all.has(name);
		const shown = all ? items : items.slice(0, ROWS);
		const list = h(
			'div',
			{ class: 'list' },
			shown.map((item) => {
				const id = `${name}:${key(item)}`;
				const [cls, head, detail] = row(item);
				const open = this.#open.has(id);
				const el = h('div', { class: `row${open ? ' open' : ''}` });
				const button = h(
					'button',
					{
						type: 'button',
						class: `rh ${cls}`,
						'aria-expanded': open ? 'true' : 'false',
						onclick: () => {
							const now = !this.#open.has(id);
							if (now) this.#open.add(id);
							else this.#open.delete(id);
							el.classList.toggle('open', now);
							button.setAttribute('aria-expanded', now ? 'true' : 'false');
						}
					},
					chevron(),
					head
				);
				return append(el, [button, h('div', { class: 'detail' }, detail)]);
			})
		);
		const more =
			!all && items.length > ROWS
				? h(
						'button',
						{
							type: 'button',
							class: 'more',
							onclick: () => {
								this.#all.add(name);
								this.render();
							}
						},
						`Show all ${items.length}`
					)
				: null;
		return [list, more];
	}

	#prs(gh, now) {
		return this.#list(
			'pr',
			gh.openPrs,
			(p) => p.url ?? p.title,
			(p) => [
				'g-pr',
				[
					h('span', { class: 'ell' }, p.title),
					h('span', { class: 'wide' }, pill(REVIEW_TONE[p.review] ?? '', p.reviewText)),
					h('span', { class: 'wide' }, pill(CHECK_TONE[p.checks] ?? '', p.checksText)),
					h('span', { class: 'dim small right' }, age(p.createdAt, now))
				],
				[
					h(
						'p',
						{ class: 'who' },
						avatar(p.author),
						h(
							'span',
							{},
							`${p.author} opened it ${ago(p.createdAt, now)} · last change ${ago(p.updatedAt, now)}`
						)
					),
					h(
						'p',
						{},
						h('span', { class: 'add num' }, `+${p.add.toLocaleString('en')}`),
						' ',
						h('span', { class: 'del num' }, `−${p.del.toLocaleString('en')}`),
						` lines · ${p.reviewText} · ${p.checksText} · `,
						p.reviewers.length
							? `review asked of ${p.reviewers.join(', ')}`
							: 'no reviewer asked yet',
						p.url ? [' · ', link(p.url, 'Open on GitHub')] : null
					)
				]
			]
		);
	}

	#people(period, now) {
		return this.#list(
			'person',
			period.people,
			(p) => p.name,
			(p) => [
				'g-person',
				[
					h(
						'span',
						{ class: 'who' },
						avatar(p.name),
						h('span', { class: 'ell' }, p.name),
						p.bot ? h('span', { class: 'tag' }, 'bot') : null
					),
					h(
						'span',
						{ class: 'num' },
						p.commits.toLocaleString('en'),
						h('span', { class: 'dim small' }, p.commits === 1 ? ' commit' : ' commits')
					),
					h('span', { class: 'dim small ell wide' }, p.areas.join(', ')),
					h('span', { class: 'wide' }, spark(p.spark)),
					h('span', { class: 'dim small right' }, ago(p.lastAt, now))
				],
				[
					h(
						'p',
						{},
						h('span', { class: 'add num' }, `+${p.add.toLocaleString('en')}`),
						' ',
						h('span', { class: 'del num' }, `−${p.del.toLocaleString('en')}`),
						' lines',
						p.areas.length ? ` · mostly in ${p.areas.join(', ')}` : ''
					),
					h(
						'ul',
						{},
						p.recent.map((c) =>
							h(
								'li',
								{},
								c.url ? link(c.url, c.subject, 'ell') : h('span', { class: 'ell' }, c.subject),
								h('span', { class: 'w' }, ago(c.at, now))
							)
						)
					)
				]
			]
		);
	}

	#commits(d, now) {
		return this.#list(
			'commit',
			d.commits,
			(c) => c.url ?? `${c.at}${c.subject}`,
			(c) => [
				'g-commit',
				[
					h('span', { class: 'ell' }, c.subject),
					h(
						'span',
						{ class: 'who small wide' },
						avatar(c.author),
						h('span', { class: 'ell' }, c.author)
					),
					h(
						'span',
						{ class: 'small num wide' },
						h('span', { class: 'add' }, `+${short(c.add)}`),
						' ',
						h('span', { class: 'del' }, `−${short(c.del)}`)
					),
					h('span', { class: 'dim small right' }, ago(c.at, now))
				],
				[
					h(
						'p',
						{},
						`${c.author} · ${plural(c.fileCount, 'file')} changed`,
						c.url ? [' · ', link(c.url, 'Open on GitHub')] : null
					),
					h(
						'ul',
						{},
						c.files.map((f) => h('li', {}, fileName(f))),
						c.fileCount > c.files.length
							? h('li', {}, `and ${plural(c.fileCount - c.files.length, 'more file')}`)
							: null
					)
				]
			]
		);
	}

	#hotspots(period, now) {
		const max = Math.max(1, ...period.hotspots.map((x) => x.changes));
		return this.#list(
			'hot',
			period.hotspots,
			(x) => x.file,
			(x) => [
				'g-hot',
				[
					fileName(x.file),
					h(
						'span',
						{ class: 'wide' },
						h(
							'span',
							{ class: 'bar' },
							h('span', { style: `width:${Math.round((x.changes / max) * 100)}%` })
						)
					),
					h(
						'span',
						{ class: 'stack wide', title: x.people.join(', ') },
						x.people.slice(0, 4).map(avatar)
					),
					h(
						'span',
						{ class: 'num small right' },
						x.changes.toLocaleString('en'),
						h('span', { class: 'dim' }, x.changes === 1 ? ' change' : ' changes')
					)
				],
				[
					h(
						'p',
						{},
						`Changed ${plural(x.changes, 'time')}, `,
						h('span', { class: 'add num' }, `+${x.add.toLocaleString('en')}`),
						' ',
						h('span', { class: 'del num' }, `−${x.del.toLocaleString('en')}`),
						` lines, last ${ago(x.lastAt, now)}.`
					),
					h(
						'p',
						{},
						`Touched by ${x.people.join(', ')}`,
						x.people.length > 2 ? ': many hands, worth keeping an eye on.' : '.'
					),
					h(
						'ul',
						{},
						x.recent.map((c) =>
							h(
								'li',
								{},
								h('span', { class: 'ell' }, c.subject),
								h('span', { class: 'w' }, `${c.who} · ${ago(c.at, now)}`)
							)
						)
					)
				]
			]
		);
	}

	#facts(d, period, gh, now) {
		const facts = [];
		if (gh) {
			const r = gh.releases[0];
			facts.push([
				'Latest release',
				r
					? [link(r.url, r.tag), h('span', { class: 'dim small' }, ` · ${ago(r.at, now)}`)]
					: h('span', { class: 'dim' }, 'None yet')
			]);
			facts.push([
				'Open issues',
				gh.openIssues === null
					? h('span', { class: 'dim' }, 'Not known')
					: [
							gh.openIssues.toLocaleString('en'),
							gh.oldestIssue
								? h(
										'span',
										{ class: 'dim small' },
										' · oldest ',
										link(gh.oldestIssue.url, `opened ${ago(gh.oldestIssue.createdAt, now)}`)
									)
								: null
						]
			]);
		}
		facts.push([
			'Last commit',
			[
				ago(d.lastCommitAt, now),
				d.branch ? h('span', { class: 'dim small' }, ` · on ${d.branch}`) : null
			]
		]);
		if (period.newPeople.length) {
			facts.push([
				'New people',
				[
					String(period.newPeople.length),
					h(
						'span',
						{ class: 'dim small' },
						` · ${period.newPeople.slice(0, 3).join(', ')}, first commits in the last ${this.#days} days`
					)
				]
			]);
		}
		return this.#section(
			'Also',
			'',
			h(
				'div',
				{ class: 'facts' },
				facts.map(([k, v]) =>
					h('div', { class: 'fact' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))
				)
			),
			''
		);
	}
}

if (!customElements.get('git-insights-tab'))
	customElements.define('git-insights-tab', GitInsightsTab);
