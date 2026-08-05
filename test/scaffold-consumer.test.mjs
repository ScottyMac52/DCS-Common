import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPreview,
  loadDeviceMap,
  resolveDeviceMapping,
  resolveInstanceHint,
  loadCalloutCatalog,
  parseArgs,
  buildDraftKneeboardConfig,
  writeConsumer,
} from '../scripts/scaffold-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('parseArgs requires preview and profiles flags', () => {
  const options = parseArgs(['--preview-json', 'out.json', '--profiles-dir', 'profiles']);
  assert.equal(options.previewJson, 'out.json');
  assert.equal(options.profilesDir, 'profiles');
});

test('parseArgs accepts write-mode identity flags', () => {
  const options = parseArgs([
    '--output-dir',
    'out',
    '--profiles-dir',
    'profiles',
    '--display-name',
    'F-16C',
    '--input-module-id',
    'F-16C_50',
    '--kneeboard-id',
    'F-16C_50',
  ]);
  assert.equal(options.outputDir, 'out');
  assert.equal(options.displayName, 'F-16C');
  assert.equal(options.inputModuleId, 'F-16C_50');
});

test('device map resolves Warthog throttle and MFD instance hints', () => {
  const map = loadDeviceMap(commonRoot);
  const throttle = resolveDeviceMapping(
    'Throttle - HOTAS Warthog {5200C960-CB32-11ed-8020-444553540000}.diff.lua',
    map,
  );
  assert.equal(throttle.deviceId, 'tm-warthog-throttle');
  assert.equal(throttle.source, 'pattern');

  const mfd = resolveDeviceMapping(
    'F16 MFD 1 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua',
    map,
  );
  assert.equal(mfd.deviceId, 'tm-mfd');
  assert.equal(resolveInstanceHint(mfd.stem, mfd.deviceId, map), '1');
});

test('overrides beat pattern matching and unknown devices stay null', () => {
  const map = loadDeviceMap(commonRoot);
  const forced = resolveDeviceMapping('Mystery Stick.diff.lua', map, {
    'Mystery Stick.diff.lua': 'vkb-f14-gunfighter',
  });
  assert.equal(forced.deviceId, 'vkb-f14-gunfighter');
  assert.equal(forced.source, 'override');

  const unknown = resolveDeviceMapping('Completely Unknown Device.diff.lua', map);
  assert.equal(unknown.deviceId, null);
  assert.equal(unknown.source, 'unmapped');
});

test('callout catalog maps JOY_BTN1 to mfd-osb-t1', () => {
  const catalog = loadCalloutCatalog(commonRoot, 'tm-mfd');
  assert.deepEqual(catalog.byKey.get('JOY_BTN1'), ['mfd-osb-t1']);
});

test('buildPreview emits base and modifier rows with hold mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-preview-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  writeFileSync(
    join(profilesDir, 'F16 MFD 1 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua'),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Left MFD OSB 1", },
      ["d2"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "AVA_F16_S3" } }, }, ["name"] = "Markpoint shortcut", },
    } } return diff`,
  );
  writeFileSync(
    join(root, 'modifiers.lua'),
    `local modifiers = {
      ["AVA_F16_S3"] = { ["device"] = "Ava Viper {GUID}", ["key"] = "JOY_BTN3", ["switch"] = false },
    }
    return modifiers`,
  );

  const preview = buildPreview({
    profilesDir,
    modifiersPath: join(root, 'modifiers.lua'),
    commonRoot,
  });

  assert.equal(preview.summary.profileCount, 1);
  assert.equal(preview.summary.rowCount, 2);
  assert.equal(preview.devices[0].deviceId, 'tm-mfd');
  assert.equal(preview.devices[0].instanceHint, '1');

  const base = preview.rows.find((row) => row.chord === '');
  const shifted = preview.rows.find((row) => row.chord === 'AVA_F16_S3');
  assert.equal(base.name, 'Left MFD OSB 1');
  assert.equal(base.calloutId, 'mfd-osb-t1');
  assert.equal(base.status, 'OK');
  assert.equal(shifted.name, 'Markpoint shortcut');
  assert.deepEqual(shifted.modifierModes, ['hold']);
  assert.equal(shifted.status, 'OK');
  assert.equal(preview.modifiers[0].mode, 'hold');
});

test('buildPreview flags unmapped devices without inventing deviceIds', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-unmapped-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  writeFileSync(
    join(profilesDir, 'Unknown Fancy Stick.diff.lua'),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN9" }, }, ["name"] = "Something", },
    } } return diff`,
  );

  const preview = buildPreview({ profilesDir, commonRoot });
  assert.equal(preview.devices[0].deviceId, null);
  assert.equal(preview.rows[0].status, 'Unmapped device');
  assert.equal(preview.rows[0].calloutId, null);
});

test('buildDraftKneeboardConfig includes base layer and modifier layer', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-draft-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'F16 MFD 1 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Left MFD OSB 1", },
      ["d2"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "AVA_F16_S3" } }, }, ["name"] = "Markpoint", },
    } } return diff`,
  );
  writeFileSync(
    join(root, 'modifiers.lua'),
    `local modifiers = { ["AVA_F16_S3"] = { ["device"] = "Ava", ["key"] = "JOY_BTN3", ["switch"] = false } } return modifiers`,
  );
  const preview = buildPreview({
    profilesDir,
    modifiersPath: join(root, 'modifiers.lua'),
    commonRoot,
  });
  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'F-16C',
    inputModuleId: 'F-16C_50',
  });
  assert.equal(config.aircraft, 'F-16C');
  assert.ok(config.profiles['tm-mfd-1']);
  assert.equal(config.pages.length, 1);
  assert.ok(config.pages[0].layers);
  assert.equal(config.pages[0].layers[0].id, 'base');
  assert.equal(config.pages[0].layers[0].controls['mfd-osb-t1'].key, 'JOY_BTN1');
  assert.ok(config.modifiersFile);
  assert.equal(config.modifiers.AVA_F16_S3.mode, 'hold');
});

test('writeConsumer materializes profiles, kneeboard.json, and report', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-write-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'F16 MFD 1 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "OSB 1", },
    } } return diff`,
  );
  const preview = buildPreview({ profilesDir, commonRoot });
  const out = join(root, 'consumer');
  const result = writeConsumer({
    preview,
    outputDir: out,
    displayName: 'F-16C',
    inputModuleId: 'F-16C_50',
    kneeboardId: 'F-16C_50',
    commonRoot,
  });
  assert.ok(existsSync(join(out, 'src/Config/Input/F-16C_50/joystick', profileName)));
  assert.ok(existsSync(join(out, 'config/kneeboard.json')));
  assert.ok(existsSync(join(out, 'scripts/build-kneeboard.mjs')));
  assert.ok(existsSync(join(out, 'SCAFFOLD-REPORT.md')));
  assert.ok(existsSync(join(out, '.github/workflows/build.yml')));
  const packageJson = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'DCS-F-16C-Components');
  assert.ok(result.plannedFiles.length > 5);
});
