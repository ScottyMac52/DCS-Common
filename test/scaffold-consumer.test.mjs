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
  resolveCatalogInputKey,
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

test('parseArgs accepts physical instance roles', () => {
  const options = parseArgs([
    '--preview-json', 'out.json', '--profiles-dir', 'profiles',
    '--roles', 'config/scaffold-instance-roles.json',
  ]);
  assert.equal(options.rolesPath, 'config/scaffold-instance-roles.json');
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

test('built-in MOZA grip selection applies only to a generic AB9 profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-moza-selection-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'MOZA AB9 FFB Flight Base {5200C960-CB32-11ed-8020-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Trigger", },
    } } return diff`,
  );

  const standalone = buildPreview({ profilesDir, mozaGrip: 'standalone', commonRoot });
  assert.equal(standalone.devices[0].deviceId, 'moza-ab9');
  assert.equal(standalone.devices[0].mappingSource, 'standalone-fallback');

  const viper = buildPreview({ profilesDir, mozaGrip: 'viper', commonRoot });
  assert.equal(viper.devices[0].deviceId, 'moza-ab9-warthog-grip');
  assert.equal(viper.devices[0].mappingSource, 'ui-selection');
  assert.equal(
    buildDraftKneeboardConfig(viper, { displayName: 'F-16C', inputModuleId: 'F-16C_50' }).pages[0].deviceId,
    'moza-ab9-warthog-grip',
  );

  const hornet = buildPreview({ profilesDir, mozaGrip: 'hornet', commonRoot });
  assert.equal(hornet.devices[0].deviceId, 'moza-ab9-hornet-grip');
  assert.equal(hornet.devices[0].mappingSource, 'ui-selection');
});

test('MOZA grip aliases translate only their verified POV keys', () => {
  const map = loadDeviceMap(commonRoot);
  for (const deviceId of ['moza-ab9-hornet-grip', 'moza-ab9-warthog-grip']) {
    assert.equal(resolveCatalogInputKey(deviceId, 'JOY_BTN_POV1_U', map), 'JOY_POV1_U');
    assert.equal(resolveCatalogInputKey(deviceId, 'JOY_BTN_POV1_R', map), 'JOY_POV1_R');
    assert.equal(resolveCatalogInputKey(deviceId, 'JOY_BTN_POV1_D', map), 'JOY_POV1_D');
    assert.equal(resolveCatalogInputKey(deviceId, 'JOY_BTN_POV1_L', map), 'JOY_POV1_L');
    assert.equal(resolveCatalogInputKey(deviceId, 'JOY_BTN1', map), 'JOY_BTN1');
  }
  assert.equal(
    resolveCatalogInputKey('grip-f18c', 'JOY_BTN_POV1_U', map),
    'JOY_BTN_POV1_U',
    'native catalog IDs must not receive MOZA-only normalization',
  );
});

test('MOZA POV bindings resolve base and modified callouts for both grips', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-moza-pov-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'MOZA AB9 FFB Flight Base {5200C960-CB32-11ed-8020-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["trim-up"] = {
        ["added"] = { [1] = { ["key"] = "JOY_BTN_POV1_U" }, },
        ["name"] = "Trim, nose up",
      },
      ["trim-down"] = {
        ["added"] = { [1] = { ["key"] = "JOY_BTN_POV1_D" }, },
        ["name"] = "Trim, nose down",
      },
      ["trim-left"] = {
        ["added"] = { [1] = { ["key"] = "JOY_BTN_POV1_L" }, },
        ["name"] = "Trim, left bank",
      },
      ["trim-right"] = {
        ["added"] = { [1] = { ["key"] = "JOY_BTN_POV1_R" }, },
        ["name"] = "Trim, right bank",
      },
      ["glance-left"] = {
        ["added"] = {
          [1] = { ["key"] = "JOY_BTN_POV1_L", ["reformers"] = { [1] = "LOOK_MODE" } },
        },
        ["name"] = "Glance left",
      },
    } } return diff`,
  );
  const modifiersPath = join(root, 'modifiers.lua');
  writeFileSync(
    modifiersPath,
    `local modifiers = {
      ["LOOK_MODE"] = {
        ["device"] = "MOZA AB9 FFB Flight Base {5200C960-CB32-11ed-8020-444553540000}",
        ["key"] = "JOY_BTN3",
        ["switch"] = false,
      },
    } return modifiers`,
  );

  const cases = [
    {
      grip: 'hornet',
      deviceId: 'moza-ab9-hornet-grip',
      callouts: {
        JOY_BTN_POV1_U: 'hornet-grip-trim-up',
        JOY_BTN_POV1_D: 'hornet-grip-trim-down',
        JOY_BTN_POV1_L: 'hornet-grip-trim-left',
        JOY_BTN_POV1_R: 'hornet-grip-trim-right',
      },
    },
    {
      grip: 'viper',
      deviceId: 'moza-ab9-warthog-grip',
      callouts: {
        JOY_BTN_POV1_U: 'warthog-grip-trim-up',
        JOY_BTN_POV1_D: 'warthog-grip-trim-down',
        JOY_BTN_POV1_L: 'warthog-grip-trim-left',
        JOY_BTN_POV1_R: 'warthog-grip-trim-right',
      },
    },
  ];

  for (const expected of cases) {
    const preview = buildPreview({
      profilesDir,
      modifiersPath,
      mozaGrip: expected.grip,
      commonRoot,
    });
    assert.equal(preview.devices[0].deviceId, expected.deviceId);
    for (const row of preview.rows) {
      assert.equal(row.calloutId, expected.callouts[row.key], `${expected.grip}: ${row.name}`);
      assert.equal(row.catalogKey, row.key.replace('JOY_BTN_POV1_', 'JOY_POV1_'));
      assert.equal(row.status, 'OK', `${expected.grip}: ${row.name}`);
    }

    const config = buildDraftKneeboardConfig(preview, {
      displayName: expected.grip,
      inputModuleId: 'TEST',
    });
    assert.equal(config.pages[0].deviceId, expected.deviceId);
    assert.ok(config.pages[0].layers);
    assert.equal(
      config.pages[0].layers[0].controls[expected.callouts.JOY_BTN_POV1_U].key,
      'JOY_BTN_POV1_U',
      'generated controls must retain the native DCS profile key',
    );
    assert.equal(
      config.pages[0].layers[1].controls[expected.callouts.JOY_BTN_POV1_L].key,
      'JOY_BTN_POV1_L',
    );
  }
});

test('parseArgs validates the built-in MOZA grip selection', () => {
  assert.equal(parseArgs(['--moza-grip', 'viper']).mozaGrip, 'viper');
  assert.throws(() => parseArgs(['--moza-grip', 'unknown']), /standalone, viper, or hornet/);
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

test('Viper TQS MIC inputs remain renderable when DCS binds them directly', () => {
  const catalog = loadCalloutCatalog(commonRoot, 'viper-tqs-mission-pack');
  assert.deepEqual(catalog.byKey.get('JOY_BTN4'), ['viper-tqs-button-04']);
  assert.deepEqual(catalog.byKey.get('JOY_BTN5'), ['viper-tqs-button-05']);
  assert.deepEqual(catalog.byKey.get('JOY_BTN6'), ['viper-tqs-button-06']);

  const root = mkdtempSync(join(tmpdir(), 'scaffold-viper-nonvisual-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  writeFileSync(
    join(profilesDir, 'Viper TQS {C0A33440-3F54-11f1-8001-444553540000}.diff.lua'),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN5" }, }, ["name"] = "Afterburner toggle", },
      ["d2"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN6" }, }, ["name"] = "Sight cage", },
    } } return diff`,
  );

  const preview = buildPreview({ profilesDir, commonRoot });
  const mic = preview.rows.find((row) => row.key === 'JOY_BTN5');
  const visible = preview.rows.find((row) => row.key === 'JOY_BTN6');
  assert.equal(mic.calloutId, 'viper-tqs-button-05');
  assert.equal(mic.status, 'OK');
  assert.equal(visible.calloutId, 'viper-tqs-button-06');
  assert.equal(visible.status, 'OK');

  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'F-100D',
    inputModuleId: 'F-100D',
  });
  assert.equal(config.pages[0].controls['viper-tqs-button-05'].key, 'JOY_BTN5');
  assert.equal(config.pages[0].controls['viper-tqs-button-06'].key, 'JOY_BTN6');
});

test('UiLayer shared hardware bindings resolve every reported callout and modifier layer', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-ui-layer-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  writeFileSync(
    join(profilesDir, ' VKBSim Gunfighter F14 {2D5CEC70-5189-11f1-8001-444553540000}.diff.lua'),
    `local diff = { ["keyDiffs"] = {
      ["d216pnilunilcdnilvdnilvpnilvunil"] = { ["added"] = {
        [1] = { ["key"] = "JOY_BTN6", ["reformers"] = { [1] = "JOY_BTN7" } },
      }, ["name"] = "recenter VR Headset" },
    } } return diff`,
  );
  writeFileSync(
    join(profilesDir, 'Viper TQS {C0A33440-3F54-11f1-8001-444553540000}.diff.lua'),
    `local diff = { ["keyDiffs"] = {
      ["d2604pnilu2604cdnilvd1vpnilvu0"] = { ["added"] = {
        [1] = { ["key"] = "JOY_BTN5", ["reformers"] = { [1] = "JOY_BTN3" } },
        [2] = { ["key"] = "JOY_BTN5", ["reformers"] = { [1] = "JOY_BTN7" } },
      }, ["name"] = "toggle VR Zoom" },
      ["d2605pnilu2605cdnilvd1vpnilvu0"] = { ["added"] = {
        [1] = { ["key"] = "JOY_BTN4", ["reformers"] = { [1] = "JOY_BTN3" } },
        [2] = { ["key"] = "JOY_BTN4", ["reformers"] = { [1] = "JOY_BTN7" } },
      }, ["name"] = "toggle VR Spyglass Zoom" },
    } } return diff`,
  );
  const modifiersPath = join(root, 'modifiers.lua');
  writeFileSync(
    modifiersPath,
    `local modifiers = {
      ["JOY_BTN3"] = { ["device"] = "Ava [R] Viper {F77212B0-00A8-11f1-8001-444553540000}", ["key"] = "JOY_BTN3", ["switch"] = false },
      ["JOY_BTN7"] = { ["device"] = "VKBSim Gunfighter F14 {2D5CEC70-5189-11f1-8001-444553540000}", ["key"] = "JOY_BTN7", ["switch"] = false },
    } return modifiers`,
  );

  const preview = buildPreview({ profilesDir, modifiersPath, commonRoot });
  assert.equal(preview.rows.length, 5);
  assert.ok(preview.rows.every((row) => row.status === 'OK'));
  assert.deepEqual(preview.rows.map((row) => row.calloutId), [
    'vkb-trigger',
    'viper-tqs-button-05',
    'viper-tqs-button-05',
    'viper-tqs-button-04',
    'viper-tqs-button-04',
  ]);

  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'UiLayer',
    inputModuleId: 'UiLayer',
  });
  const vkbPage = config.pages.find((page) => page.deviceId === 'vkb-f14-gunfighter');
  const viperPage = config.pages.find((page) => page.deviceId === 'viper-tqs-mission-pack');
  assert.deepEqual(vkbPage.layers.map((layer) => layer.id), ['base', 'JOY_BTN7']);
  assert.deepEqual(viperPage.layers.map((layer) => layer.id), ['base', 'JOY_BTN3', 'JOY_BTN7']);
  assert.equal(vkbPage.layers[1].controls['vkb-trigger'].key, 'JOY_BTN6');
  assert.equal(viperPage.layers[1].controls['viper-tqs-button-05'].key, 'JOY_BTN5');
  assert.equal(viperPage.layers[2].controls['viper-tqs-button-04'].key, 'JOY_BTN4');
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

test('buildPreview reports profile reformers missing from modifiers.lua', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-missing-modifier-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profileName = 'F16 MFD 1 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua';
  writeFileSync(
    join(profilesDir, profileName),
    `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Base binding", },
      ["d2"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "JOY_BTN7" } }, }, ["name"] = "Shifted binding", },
    } } return diff`,
  );
  const modifiersPath = join(root, 'modifiers.lua');
  writeFileSync(
    modifiersPath,
    `local modifiers = {
      ["JOY_BTN3"] = { ["device"] = "Another device", ["key"] = "JOY_BTN3", ["switch"] = false },
    } return modifiers`,
  );

  const preview = buildPreview({ profilesDir, modifiersPath, commonRoot });
  const shifted = preview.rows.find((row) => row.chord === 'JOY_BTN7');
  assert.equal(shifted.status, 'Unknown modifier');
  assert.deepEqual(shifted.modifierModes, [null]);
  assert.deepEqual(shifted.unknownModifiers, ['JOY_BTN7']);
  assert.equal(preview.summary.errorCount, 1);
  assert.match(preview.errors[0], /JOY_BTN7.*not declared in modifiers\.lua/);

  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'F4U-1D',
    inputModuleId: 'F4U-1D',
  });
  assert.equal(config.pages[0].layers, undefined);
  assert.equal(config.pages[0].controls['mfd-osb-t1'].key, 'JOY_BTN1');
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
    readFileSync(mapPath, 'utf8'),
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


test('repeated identical hardware gets one stable profile and kneeboard page per GUID', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-repeated-quadrant-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const first = 'Logitech Flight Quadrant {11111111-1111-1111-1111-111111111111}.diff.lua';
  const second = 'Logitech Flight Quadrant {22222222-2222-2222-2222-222222222222}.diff.lua';
  writeFileSync(join(profilesDir, first), `local diff = { ["axisDiffs"] = {
    ["a1"] = { ["added"] = { [1] = { ["key"] = "JOY_Z" }, }, ["name"] = "Supercharger handle", },
  } } return diff`);
  writeFileSync(join(profilesDir, second), `local diff = { ["axisDiffs"] = {
    ["a2"] = { ["added"] = { [1] = { ["key"] = "JOY_Z" }, }, ["name"] = "Mixture handle", },
  } } return diff`);

  const preview = buildPreview({ profilesDir, commonRoot });
  assert.equal(preview.devices.length, 2);
  assert.equal(preview.devices[0].deviceId, preview.devices[1].deviceId);
  assert.notEqual(preview.devices[0].guid, preview.devices[1].guid);
  assert.notEqual(preview.devices[0].profileKey, preview.devices[1].profileKey);
  assert.deepEqual(preview.rows.map((row) => row.key), ['JOY_Z', 'JOY_Z']);

  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'Combined Arms',
    inputModuleId: 'CombinedArms',
  });
  assert.equal(Object.keys(config.profiles).length, 2);
  assert.equal(config.pages.length, 2);
  assert.notEqual(config.pages[0].profile, config.pages[1].profile);
  assert.equal(config.pages[0].deviceId, config.pages[1].deviceId);
});

test('semantic roles distinguish two Warthog sticks while reusing canonical hardware', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-role-sticks-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const left = 'Joystick - HOTAS Warthog {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}.diff.lua';
  const right = 'Joystick - HOTAS Warthog {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}.diff.lua';
  for (const profile of [left, right]) {
    writeFileSync(join(profilesDir, profile), `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Fire", },
    } } return diff`);
  }
  const rolesPath = join(root, 'roles.json');
  writeFileSync(rolesPath, JSON.stringify({
    [left]: 'left-tank-control',
    'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB': 'right-tank-control',
  }));

  const preview = buildPreview({ profilesDir, rolesPath, commonRoot });
  assert.deepEqual(preview.devices.map((device) => device.role), [
    'left-tank-control',
    'right-tank-control',
  ]);
  assert.deepEqual(preview.devices.map((device) => device.profileKey), [
    'tm-warthog-grip-left-tank-control',
    'tm-warthog-grip-right-tank-control',
  ]);
  const config = buildDraftKneeboardConfig(preview, {
    displayName: 'Combined Arms',
    inputModuleId: 'CombinedArms',
  });
  assert.equal(config.pages.length, 2);
  assert.ok(config.profiles['tm-warthog-grip-left-tank-control']);
  assert.ok(config.profiles['tm-warthog-grip-right-tank-control']);
  assert.ok(config.pages.every((page) => page.deviceId === 'tm-warthog-grip'));
});

test('duplicate semantic roles are rejected for the same canonical device', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-duplicate-roles-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  const profiles = [
    'Joystick - HOTAS Warthog {CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC}.diff.lua',
    'Joystick - HOTAS Warthog {DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}.diff.lua',
  ];
  for (const profile of profiles) {
    writeFileSync(join(profilesDir, profile), `local diff = { ["keyDiffs"] = {
      ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Fire", },
    } } return diff`);
  }
  const rolesPath = join(root, 'roles.json');
  writeFileSync(rolesPath, JSON.stringify(Object.fromEntries(profiles.map((profile) => [profile, 'tank-control']))));

  const preview = buildPreview({ profilesDir, rolesPath, commonRoot });
  assert.ok(preview.errors.some((error) => /profile key conflict/i.test(error)));
});

test('numbered MFD instance hints keep their established profile aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-mfd-instances-'));
  const profilesDir = join(root, 'joystick');
  mkdirSync(profilesDir);
  for (const number of [1, 2]) {
    writeFileSync(
      join(profilesDir, `F16 MFD ${number} {EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEE${number}}.diff.lua`),
      `local diff = { ["keyDiffs"] = {
        ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "OSB 1", },
      } } return diff`,
    );
  }

  const preview = buildPreview({ profilesDir, commonRoot });
  assert.deepEqual(preview.devices.map((device) => device.profileKey), ['tm-mfd-1', 'tm-mfd-2']);
});
