import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompleteMock, parseHardwareControls, writeCompleteMock } from '../scripts/generate-complete-build-mock.mjs';
import { loadProfileDrivenConfig } from '../scripts/profile-driven-kneeboard.mjs';
import { loadSharedHardware } from '../scripts/shared-hardware-consumer.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hardwareRoot = join(root, 'assets', 'shared', 'hardware');

test('complete-build mock mirrors every schema-versioned Lua catalog', () => {
  const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
  const { config, profileFiles } = buildCompleteMock(root);
  assert.equal(config.pages.length, manifest.devices.length);
  assert.equal(new Set(config.pages.map(({ deviceId }) => deviceId)).size, manifest.devices.length);

  for (const device of manifest.devices) {
    const controls = parseHardwareControls(readFileSync(join(hardwareRoot, device.lua), 'utf8'));
    const page = config.pages.find(({ deviceId }) => deviceId === device.id);
    const grouped = new Map();
    for (const control of controls) {
      if (!grouped.has(control.id)) grouped.set(control.id, []);
      grouped.get(control.id).push(control);
    }
    assert.deepEqual(Object.keys(page.controls).sort(), [...grouped.keys()].sort(), `${device.id} controls`);
    assert.deepEqual(Object.keys(page.labels).sort(), [...grouped.keys()].sort(), `${device.id} labels`);
    for (const [id, entries] of grouped) {
      const expected = [...new Set(entries.map(({ hardwareLabel }) => hardwareLabel))].join(' / ');
      assert.equal(page.labels[id], expected, `${device.id}:${id} label`);
      const references = Array.isArray(page.controls[id]) ? page.controls[id] : [page.controls[id]];
      assert.equal(references.length, entries.length, `${device.id}:${id} binding count`);
      assert.ok(references.every(({ label }) => label === expected), `${device.id}:${id} control labels must equal labels entry`);
    }
    if (controls.length === 0) {
      assert.deepEqual(page.labels, {}, `${device.id} non-Lua callouts must be blank`);
    } else {
      assert.ok(profileFiles[config.profiles[`hardware-${device.id}`]], `${device.id} profile mock`);
    }
  }
});

test('complete-build summary uses the renderer text field for every TX row', () => {
  const { config } = buildCompleteMock(root);
  assert.ok(config.summaryPages[0].items.every(({ text }) => text));
});

test('generated profiles resolve identical labels and leave non-Lua callouts blank', () => {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'dcs-complete-mock-'));
  writeCompleteMock({ commonRoot: root, consumerRoot });
  const config = loadProfileDrivenConfig('config/kneeboard.json', { commonRoot: root, consumerRoot });
  for (const page of config.pages) {
    for (const [id, configured] of Object.entries(page.controls)) {
      const references = Array.isArray(configured) ? configured : [configured];
      assert.ok(references.every(({ label }) => label === page.labels[id]), `${page.deviceId}:${id} resolved parity`);
    }
    const { calloutIds } = loadSharedHardware(page.deviceId, { commonRoot: root });
    for (const id of calloutIds) {
      if (!Object.hasOwn(page.controls, id)) assert.equal(page.labels[id], undefined, `${page.deviceId}:${id} stays blank`);
    }
  }
});
