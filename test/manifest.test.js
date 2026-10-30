import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import plugin, { DEFAULT_IGNORE } from '../wheelhouse/server/index.js';

const manifest = JSON.parse(
	readFileSync(new URL('../.wheelhouse-plugin/plugin.json', import.meta.url), 'utf8')
);
// A copy of Wheelhouse's packages/plugin-sdk/plugin.schema.json.
const schema = JSON.parse(readFileSync(new URL('./plugin.schema.json', import.meta.url), 'utf8'));

describe('the manifest', () => {
	it('follows the Wheelhouse plugin schema', () => {
		const validate = new Ajv2020({ strict: false }).compile(schema);
		assert.ok(validate(manifest), JSON.stringify(validate.errors));
	});

	it('is off until turned on, and names entries that exist', () => {
		assert.equal(manifest.wheelhouse.enabledByDefault, false);
		assert.ok(existsSync(new URL(`../${manifest.wheelhouse.server}`, import.meta.url)));
		assert.ok(existsSync(new URL(`../${manifest.wheelhouse.ui}`, import.meta.url)));
	});

	it('lists exactly what the server entry contributes', () => {
		assert.deepEqual(
			plugin.contributions.map((c) => ({ id: c.id, slot: c.slot })),
			manifest.wheelhouse.contributions
		);
		assert.deepEqual(manifest.wheelhouse.services, []);
		for (const c of plugin.contributions) {
			assert.ok(plugin.providers.some((p) => p.id === c.provider));
			// An installed plugin's element tag starts with its id and a dash.
			assert.ok(c.render.element.startsWith(`${manifest.name}-`));
		}
	});

	it('stays within the provider limits Wheelhouse allows', () => {
		for (const p of plugin.providers) {
			assert.equal(p.scope, 'project');
			assert.ok(p.timeoutMs <= 10_000);
		}
	});

	it('offers the same defaults the code falls back to', () => {
		const s = manifest.wheelhouse.settings;
		assert.deepEqual(s.hotspotIgnore.default, DEFAULT_IGNORE);
		assert.equal(s.refreshMinutes.default, 60);
		assert.equal(s.defaultDays.default, '30');
		assert.equal(s.includeBots.default, true);
	});

	it('agrees with package.json on the version', () => {
		const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		assert.equal(pkg.version, manifest.version);
	});
});
