import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyReconciliation, compareCatalogs, inspectCatalog } from '../scripts/manage-ui-layer-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(root, 'assets/shared/ui-layer/input/UiLayer');

test('definitive UI Layer snapshot is valid and complete', () => {
  const catalog = inspectCatalog(canonical);
  assert.equal(catalog.valid, true, catalog.errors.join('\n'));
  assert.equal(catalog.summary.profiles, 6);
  assert.equal(catalog.summary.bindings, 62);
  assert.equal(catalog.summary.keys, 62);
  assert.equal(catalog.summary.axes, 0);
  assert.equal(catalog.summary.modifiers, 11);
  assert.ok(catalog.summary.possibilities > catalog.summary.profiles);
  assert.ok(catalog.possibilities.some(({ deviceId, modifier }) =>
    deviceId === 'vkb-f14-gunfighter' && modifier === 'VKB_F14_BTN7'));
  assert.ok(catalog.possibilities.some(({ deviceId, modifier }) =>
    deviceId === 'moza-ab9-hornet-grip' && modifier === 'MOZA_MODIFIER_BTN3'));
  assert.ok(catalog.possibilities.some(({ deviceId, modifier }) =>
    deviceId === 'ava-base-f16c' && modifier === 'AVA_BASE_MODIFIER_BTN3'));
  assert.ok(catalog.possibilities.some(({ deviceId, overlayStatus }) =>
    deviceId === 'tm-tpr' && overlayStatus === 'exempt'));
  assert.ok(catalog.profiles.some(({ relativePath }) => relativePath === 'keyboard/Keyboard.diff.lua'));
  assert.ok(catalog.modifiers.some(({ name }) => name === 'AVA_BASE_MODIFIER_BTN3'));
  assert.ok(catalog.modifiers.some(({ name }) => name === 'MOZA_MODIFIER_BTN3'));
  assert.equal(catalog.modifiers.some(({ name }) => name === 'TM_AVA_BASE_F16_MODIFIER'), false);
  assert.equal(catalog.modifiers.some(({ name }) => name === 'MOZA_F16_F18_BTN3'), false);
});

test('partial observed snapshot cannot shrink or redefine the definitive catalog implicitly', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ui-layer-partial-'));
  const target = join(fixture, 'UiLayer');
  const source = join(fixture, 'source');
  cpSync(canonical, target, { recursive: true });
  cpSync(canonical, source, { recursive: true });
  rmSync(join(source, 'joystick'), { recursive: true });

  const before = inspectCatalog(target).fingerprint;
  const comparison = compareCatalogs(target, source);
  assert.ok(comparison.changes.some(({ state, action }) => state === 'CanonicalOnly' && action === 'Keep'));
  assert.ok(comparison.canonical.profiles.some(({ catalogState }) => catalogState === 'Definitive only'));
  assert.equal(inspectCatalog(target).fingerprint, before, 'comparison mutated the definitive catalog');

  const result = applyReconciliation(target, source, comparison.changes);
  assert.equal(result.fingerprint, before, 'default Keep decisions changed the definitive catalog');
});

test('definitive fingerprint covers bindings, overlays, functions, and hardware possibilities', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ui-layer-fingerprint-'));
  const shared = join(fixture, 'assets/shared');
  mkdirSync(shared, { recursive: true });
  cpSync(join(root, 'assets/shared/ui-layer'), join(shared, 'ui-layer'), { recursive: true });
  mkdirSync(join(shared, 'hardware'), { recursive: true });
  cpSync(join(root, 'assets/shared/hardware/manifest.json'), join(shared, 'hardware/manifest.json'));
  const target = join(shared, 'ui-layer/input/UiLayer');
  const before = inspectCatalog(target).fingerprint;
  const overlays = join(shared, 'ui-layer/hardware-overlays.json');
  writeFileSync(overlays, readFileSync(overlays, 'utf8').replace('#0891b2', '#0891b3'));
  assert.notEqual(inspectCatalog(target).fingerprint, before);
});

test('catalog reconciliation keeps absences and applies explicit validated additions atomically', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ui-layer-catalog-'));
  const target = join(fixture, 'UiLayer');
  const source = join(fixture, 'source');
  cpSync(canonical, target, { recursive: true });
  cpSync(canonical, source, { recursive: true });
  mkdirSync(join(source, 'mouse'), { recursive: true });
  writeFileSync(join(source, 'mouse/Mouse.diff.lua'), `local diff = { ["keyDiffs"] = {
    ["mouse-test"] = { ["added"] = { [1] = { ["key"] = "MOUSE_BTN1" }, }, ["name"] = "Mouse test", },
  } } return diff`);

  const comparison = compareCatalogs(target, source);
  const addition = comparison.changes.find(({ relativePath }) => relativePath === 'mouse/Mouse.diff.lua');
  assert.equal(addition.action, 'Add');
  const result = applyReconciliation(target, source, comparison.changes);
  assert.equal(result.valid, true);
  assert.ok(result.profiles.some(({ relativePath }) => relativePath === 'mouse/Mouse.diff.lua'));
  assert.match(readFileSync(join(target, 'mouse/Mouse.diff.lua'), 'utf8'), /MOUSE_BTN1/);
});
