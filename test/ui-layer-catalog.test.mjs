import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyzeConsumerImpact, applyAuthoritativeEdits, applyReconciliation, compareCatalogs, inspectCatalog, serializeModifiers } from '../scripts/manage-ui-layer-catalog.mjs';

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
  assert.ok(catalog.bindings.some(({ deviceId, deviceInstance, functionId, controlId, bindingId }) =>
    deviceId === 'tm-mfd' && deviceInstance === 'MFD3' && functionId && controlId && bindingId));
  assert.ok(catalog.bindings.some(({ deviceId, key, controlId }) =>
    deviceId === 'ava-base-f16c' && key === 'JOY_BTN_POV1_U' && controlId),
    'input aliases must resolve back to their shared control');
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

test('authoritative binding edits create profiles atomically and reject stale previews', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dcs-common-authoring-'));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'dcs-common' }));
  mkdirSync(join(fixture, 'assets/shared'), { recursive: true });
  cpSync(join(root, 'assets/shared/ui-layer'), join(fixture, 'assets/shared/ui-layer'), { recursive: true });
  cpSync(join(root, 'assets/shared/hardware'), join(fixture, 'assets/shared/hardware'), { recursive: true });
  const input = join(fixture, 'assets/shared/ui-layer/input/UiLayer');
  const before = inspectCatalog(input);
  const filename = 'Viper TQS Authoring.diff.lua';
  const result = applyAuthoritativeEdits(fixture, {
    expectedFingerprint: before.fingerprint,
    bindings: [{ action: 'upsert', profile: { category: 'joystick', filename, deviceId: 'viper-tqs-mission-pack' },
      section: 'keyDiffs', key: 'JOY_BTN11', reformers: [], command: 'd2604pnilu2604cdnilvd1vpnilvu0', name: 'VR Zoom' }],
  });
  assert.ok(result.changedFiles.includes(`input/UiLayer/joystick/${filename}`));
  assert.match(readFileSync(join(input, 'joystick', filename), 'utf8'), /JOY_BTN11/);
  assert.throws(() => applyAuthoritativeEdits(fixture, { expectedFingerprint: before.fingerprint, bindings: [] }), /Stale definitive UI Layer catalog/);
});

test('authoritative edits accept the DCS input alias selected from a shared control', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dcs-common-alias-authoring-'));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'dcs-common' }));
  mkdirSync(join(fixture, 'assets/shared'), { recursive: true });
  cpSync(join(root, 'assets/shared/ui-layer'), join(fixture, 'assets/shared/ui-layer'), { recursive: true });
  cpSync(join(root, 'assets/shared/hardware'), join(fixture, 'assets/shared/hardware'), { recursive: true });
  const input = join(fixture, 'assets/shared/ui-layer/input/UiLayer');
  const before = inspectCatalog(input);
  const filename = 'Ava [R] Viper Alias.diff.lua';
  const result = applyAuthoritativeEdits(fixture, {
    expectedFingerprint: before.fingerprint,
    bindings: [{ action: 'upsert', profile: { category: 'joystick', filename, deviceId: 'ava-base-f16c' },
      section: 'keyDiffs', key: 'JOY_BTN_POV1_U', reformers: [], command: 'd2604pnilu2604cdnilvd1vpnilvu0', name: 'VR Zoom' }],
  });
  assert.ok(result.changedFiles.includes(`input/UiLayer/joystick/${filename}`));
  assert.match(readFileSync(join(input, 'joystick', filename), 'utf8'), /JOY_BTN_POV1_U/);
});

test('layer serialization is deterministic and rejects ambiguous physical modifiers', () => {
  const source = serializeModifiers([
    { name: 'SECOND', device: 'Device B', key: 'JOY_BTN2', mode: 'toggle' },
    { name: 'FIRST', device: 'Device A', key: 'JOY_BTN1', mode: 'hold' },
  ]);
  assert.ok(source.indexOf('["FIRST"]') < source.indexOf('["SECOND"]'));
  assert.throws(() => serializeModifiers([
    { name: 'A', device: 'Device', key: 'JOY_BTN1', mode: 'hold' },
    { name: 'B', device: 'Device', key: 'JOY_BTN1', mode: 'hold' },
  ]), /Duplicate modifier physical input/);
});


test('authoritative edits preserve multi-modifier chords and report explicit and compatibility consumers', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dcs-common-impact-'));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'dcs-common' }));
  mkdirSync(join(fixture, 'assets/shared'), { recursive: true });
  cpSync(join(root, 'assets/shared/ui-layer'), join(fixture, 'assets/shared/ui-layer'), { recursive: true });
  cpSync(join(root, 'assets/shared/hardware'), join(fixture, 'assets/shared/hardware'), { recursive: true });
  const input = join(fixture, 'assets/shared/ui-layer/input/UiLayer');
  const before = inspectCatalog(input);
  const explicit = join(fixture, '..', `explicit-${Date.now()}`);
  const compatibility = join(fixture, '..', `compatibility-${Date.now()}`);
  mkdirSync(join(explicit, 'config'), { recursive: true });
  mkdirSync(join(compatibility, 'config'), { recursive: true });
  writeFileSync(join(explicit, 'config/kneeboard.json'), JSON.stringify({ uiLayerUtilization: { mode: 'explicit',
    bindings: [{ deviceId: 'viper-tqs-mission-pack', functionId: 'vr-zoom', modifiers: ['LAYER_A', 'LAYER_B'] }] } }));
  writeFileSync(join(compatibility, 'config/kneeboard.json'), '{}');
  try {
    const modifiers = [...before.modifiers.map(({ name, device, key, mode }) => ({ name, device, key, mode })),
      { name: 'LAYER_A', device: 'Test Device', key: 'JOY_BTN90', mode: 'hold' },
      { name: 'LAYER_B', device: 'Test Device', key: 'JOY_BTN91', mode: 'hold' }];
    const result = applyAuthoritativeEdits(fixture, { expectedFingerprint: before.fingerprint, modifiers,
      consumerRoots: [explicit, compatibility],
      bindings: [{ action: 'upsert', profile: { category: 'joystick', filename: 'Viper TQS Mission Pack.diff.lua',
        deviceId: 'viper-tqs-mission-pack' }, section: 'keyDiffs', key: 'JOY_BTN11',
        reformers: ['LAYER_B', 'LAYER_A'], command: 'd2604pnilu2604cdnilvd1vpnilvu0', name: 'VR Zoom' }] });
    const authored = result.bindings.find(({ key, command }) => key === 'JOY_BTN11' && command === 'd2604pnilu2604cdnilvd1vpnilvu0');
    assert.deepEqual(authored.modifiers, ['LAYER_A', 'LAYER_B']);
    assert.equal(result.impact.explicitConsumers.length, 1);
    assert.equal(result.impact.compatibilityConsumers.length, 1);
    assert.match(result.impact.summary, /re-scaffold/i);
  } finally {
    rmSync(explicit, { recursive: true, force: true });
    rmSync(compatibility, { recursive: true, force: true });
  }
});

test('consumer impact reports only explicit selections matching a changed binding', () => {
  const binding = { deviceId: 'tm-mfd', deviceInstance: 'MFD3', functionId: 'vr-zoom',
    controlId: 'osb-1', key: 'JOY_BTN1', modifiers: ['SHIFT'], command: 'zoom' };
  const unchanged = { ...binding, controlId: 'osb-2', key: 'JOY_BTN2' };
  const rootA = mkdtempSync(join(tmpdir(), 'impact-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'impact-b-'));
  for (const consumer of [rootA, rootB]) mkdirSync(join(consumer, 'config'), { recursive: true });
  writeFileSync(join(rootA, 'config/kneeboard.json'), JSON.stringify({ uiLayerUtilization: { mode: 'explicit',
    bindings: [{ deviceId: 'tm-mfd', deviceInstance: 'MFD3', functionId: 'vr-zoom', modifiers: ['SHIFT'] }] } }));
  writeFileSync(join(rootB, 'config/kneeboard.json'), JSON.stringify({ uiLayerUtilization: { mode: 'explicit',
    bindings: [{ deviceId: 'tm-mfd', deviceInstance: 'MFD1', functionId: 'vr-zoom', modifiers: ['SHIFT'] }] } }));
  const impact = analyzeConsumerImpact(root, { bindings: [binding], modifiers: [] },
    { bindings: [unchanged], modifiers: [] }, [rootA, rootB]);
  assert.equal(impact.explicitConsumers.length, 1);
  assert.equal(impact.explicitConsumers[0].root, rootA);
});
