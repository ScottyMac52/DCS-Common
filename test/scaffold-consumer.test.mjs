import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
} from '../scripts/scaffold-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('parseArgs requires preview and profiles flags', () => {
  const options = parseArgs(['--preview-json', 'out.json', '--profiles-dir', 'profiles']);
  assert.equal(options.previewJson, 'out.json');
  assert.equal(options.profilesDir, 'profiles');
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
