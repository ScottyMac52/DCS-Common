import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initializeBlankConsumer, moduleAuthoringFingerprint, saveModuleAuthoring } from '../scripts/ipi-authoring.mjs';
import { parseDcsModifiersLua } from '../scripts/profile-driven-kneeboard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('blank clone authoring creates the first profile and buildable consumer sources without Saved Games', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'ipi-blank-clone-'));
  const result = initializeBlankConsumer({ commonRoot: root, repositoryRoot, displayName: 'Test Jet',
    inputModuleId: 'TestJet', kneeboardId: 'TestJet', deviceId: 'viper-tqs-mission-pack',
    profileFilename: 'Viper TQS.diff.lua' });
  assert.ok(existsSync(join(repositoryRoot, 'src/Config/Input/TestJet/joystick/Viper TQS.diff.lua')));
  assert.ok(existsSync(join(repositoryRoot, 'config/kneeboard.json')));
  assert.ok(existsSync(join(repositoryRoot, 'scripts/build-kneeboard.mjs')));
  const config = JSON.parse(readFileSync(join(repositoryRoot, 'config/kneeboard.json')));
  assert.equal(config.pages[0].deviceId, 'viper-tqs-mission-pack');
  assert.equal(result.rebuild.kneeboards, true);
});

test('module layer and utilization authoring is deterministic and stale protected', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'ipi-module-authoring-'));
  initializeBlankConsumer({ commonRoot: root, repositoryRoot, displayName: 'Test Jet', inputModuleId: 'TestJet',
    kneeboardId: 'TestJet', deviceId: 'viper-tqs-mission-pack', profileFilename: 'Viper TQS.diff.lua' });
  const before = moduleAuthoringFingerprint(repositoryRoot, 'TestJet');
  const result = saveModuleAuthoring({ repositoryRoot, inputModuleId: 'TestJet', expectedFingerprint: before,
    modifiers: [{ name: 'SHIFT', device: 'Viper TQS', key: 'JOY_BTN3', mode: 'hold', semanticModifier: 'grip-shift', deviceId: 'viper-tqs-mission-pack' }],
    uiLayerUtilization: { mode: 'explicit', bindings: [{ deviceId: 'viper-tqs-mission-pack', functionId: 'vr-zoom', modifiers: ['SHIFT'] }] } });
  assert.notEqual(result.fingerprint, before);
  const modifiers = parseDcsModifiersLua(readFileSync(join(repositoryRoot, 'src/Config/Input/TestJet/modifiers.lua'), 'utf8')).modifiers;
  assert.deepEqual(modifiers.map(({ name }) => name), ['SHIFT']);
  const config = JSON.parse(readFileSync(join(repositoryRoot, 'config/kneeboard.json')));
  assert.equal(config.uiLayerUtilization.bindings.length, 1);
  assert.throws(() => saveModuleAuthoring({ repositoryRoot, inputModuleId: 'TestJet', expectedFingerprint: before }), /Stale module authoring state/);
});
