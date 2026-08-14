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

test('parseArgs accepts a consumer-owned device override map', () => {
  const options = parseArgs([
    '--preview-json', 'out.json', '--profiles-dir', 'profiles',
    '--map', 'config/scaffold-device-overrides.json',
  ]);
  assert.equal(options.mapPath, 'config/scaffold-device-overrides.json');
});

test('device map resolves conservative base and grip combinations', () => {
  const map = loadDeviceMap(commonRoot);
  const cases = [
    ['Ava [R] Viper {GUID}.diff.lua', 'ava-base-f16c', 'pattern'],
    ['Ava [R] Hornet {GUID}.diff.lua', 'ava-base-f18c', 'pattern'],
    ['Joystick - HOTAS Warthog {GUID}.diff.lua', 'tm-warthog-grip', 'pattern'],
    ['Joystick - HOTAS Warthog F/A-18C {GUID}.diff.lua', 'warthog-base-hornet-grip', 'pattern'],
    ['MOZA AB9 FFB Base {GUID}.diff.lua', 'moza-ab9', 'standalone-fallback'],
    ['MOZA AB9 F-16C {GUID}.diff.lua', 'moza-ab9-warthog-grip', 'pattern'],
    ['MOZA AB9 Hornet {GUID}.diff.lua', 'moza-ab9-hornet-grip', 'pattern'],
  ];
  for (const [filename, deviceId, source] of cases) {
    const resolved = resolveDeviceMapping(filename, map);
    assert.equal(resolved.deviceId, deviceId, filename);
    assert.equal(resolved.source, source, filename);
  }

  for (const ambiguous of ['AVA Base {GUID}.diff.lua', 'Warthog Grip {GUID}.diff.lua', 'F-16C Grip {GUID}.diff.lua']) {
    assert.equal(resolveDeviceMapping(ambiguous, map).deviceId, null, ambiguous);
  }
});

test('the same generic AB9 filename resolves per consumer override', () => {
  const map = loadDeviceMap(commonRoot);
  const filename = 'MOZA AB9 FFB Flight Base {5200C960-CB32-11ed-8020-444553540000}.diff.lua';

  const standalone = resolveDeviceMapping(filename, map);
  assert.equal(standalone.deviceId, 'moza-ab9');
  assert.equal(standalone.source, 'standalone-fallback');

  const viper = resolveDeviceMapping(filename, map, {
    'MOZA AB9 FFB Flight Base': 'moza-ab9-warthog-grip',
  });
  assert.equal(viper.deviceId, 'moza-ab9-warthog-grip');
  assert.equal(viper.source, 'override');

  const hornet = resolveDeviceMapping(filename, map, {
    [filename]: 'moza-ab9-hornet-grip',
  });
  assert.equal(hornet.deviceId, 'moza-ab9-hornet-grip');
  assert.equal(hornet.source, 'override');
});

test('manifest aliases support every base and grip override', () => {
  const map = loadDeviceMap(commonRoot);
  const aliases = [
    ['ava-base-warthog-grip', 25],
    ['warthog-base-warthog-grip', 25],
    ['moza-ab9-warthog-grip', 25],
    ['ava-base-hornet-grip', 29],
    ['warthog-base-hornet-grip', 29],
    ['moza-ab9-hornet-grip', 29],
  ];
  for (const [deviceId, calloutCount] of aliases) {
    const filename = `${deviceId}.diff.lua`;
    const resolved = resolveDeviceMapping(filename, map, { [filename]: deviceId });
    assert.equal(resolved.deviceId, deviceId);
    assert.equal(resolved.source, 'override');
    assert.equal(loadCalloutCatalog(commonRoot, deviceId).controls.length, calloutCount);
  }
});

test('device map resolves the Warthog throttle and MFD instance hints', () => {
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
  assert.equal(shifted.calloutId, 'mfd-osb-t1-shifted');
  assert.deepEqual(shifted.modifierModes, ['hold']);
  assert.equal(shifted.status, 'OK');
  assert.equal(preview.modifiers[0].mode, 'hold');
});

test('buildPreview preserves an AB9 grip alias and rejects an invalid override', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-moza-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'MOZA AB9 FFB Flight Base {5200C960-CB32-11ed-8020-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Trigger", },
    } } return diff`,
  );

  const viperMap = join(root, 'viper-map.json');
  writeFileSync(viperMap, JSON.stringify({
    'MOZA AB9 FFB Flight Base': 'moza-ab9-warthog-grip',
  }));
  const viper = buildPreview({ profilesDir, mapPath: viperMap, commonRoot });
  assert.equal(viper.devices[0].deviceId, 'moza-ab9-warthog-grip');
  assert.equal(viper.devices[0].mappingSource, 'override');
  assert.equal(viper.rows[0].deviceId, 'moza-ab9-warthog-grip');
  assert.equal(viper.rows[0].mappingSource, 'override');
  const config = buildDraftKneeboardConfig(viper, {
    displayName: 'F-16C',
    inputModuleId: 'F-16C_50',
  });
  assert.equal(config.pages[0].deviceId, 'moza-ab9-warthog-grip');

  const invalidMap = join(root, 'invalid-map.json');
  writeFileSync(invalidMap, JSON.stringify({
    'MOZA AB9 FFB Flight Base': 'invented-moza-grip',
  }));
  const invalid = buildPreview({ profilesDir, mapPath: invalidMap, commonRoot });
  assert.equal(invalid.devices[0].deviceId, null);
  assert.equal(invalid.devices[0].mappingSource, 'invalid-override');
  assert.ok(invalid.errors[0].includes(profileName));
  assert.ok(invalid.errors[0].includes('invented-moza-grip'));
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

test('writeConsumer preserves the consumer-owned device override map', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-map-copy-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'MOZA AB9 FFB Flight Base.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Trigger", },
    } } return diff`,
  );
  const mapPath = join(root, 'device-overrides.json');
  writeFileSync(mapPath, JSON.stringify({
    'MOZA AB9 FFB Flight Base': 'moza-ab9-hornet-grip',
  }, null, 2));

  const preview = buildPreview({ profilesDir, mapPath, commonRoot });
  const out = join(root, 'consumer');
  writeConsumer({
    preview,
    outputDir: out,
    displayName: 'F/A-18C',
    inputModuleId: 'FA-18C_hornet',
    kneeboardId: 'FA-18C_hornet',
    commonRoot,
  });

  assert.equal(
    readFileSync(join(out, 'config/scaffold-device-overrides.json'), 'utf8'),
    `${readFileSync(mapPath, 'utf8')}\n`,
  );
  const config = JSON.parse(readFileSync(join(out, 'config/kneeboard.json'), 'utf8'));
  assert.equal(config.pages[0].deviceId, 'moza-ab9-hornet-grip');
  assert.match(readFileSync(join(out, 'SCAFFOLD-REPORT.md'), 'utf8'), /moza-ab9-hornet-grip \(override\)/);
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
