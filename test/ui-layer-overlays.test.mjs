import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildUiLayerHardwareTemplate,
  composeUiLayerLabels,
  loadUiLayerCatalog,
  validateUiLayerCatalog,
} from '../scripts/ui-layer-overlays.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('every shared device has a completed overlay, fill-in template, or explicit exemption', () => {
  const catalog = loadUiLayerCatalog();
  const results = validateUiLayerCatalog(catalog);
  assert.equal(results.length, catalog.hardware.length);
  assert.ok(results.every((entry) => ['complete', 'template', 'exempt'].includes(entry.status)));
  assert.equal(results.find((entry) => entry.deviceId === 'moza-ab9').status, 'exempt');
  assert.equal(results.find((entry) => entry.deviceId === 'tm-tpr').status, 'exempt');
});

test('templates derive their unassigned entries from the authoritative function catalog', () => {
  const catalog = loadUiLayerCatalog();
  const extended = {
    ...catalog,
    functions: [...catalog.functions, {
      id: 'future-ui-function',
      command: 'future-command',
      label: 'Future UI Function',
      category: 'General',
    }],
  };
  const template = buildUiLayerHardwareTemplate('winctrl-icp', extended);
  assert.equal(template.status, 'template');
  assert.ok(template.functions.some((entry) => entry.id === 'future-ui-function' && entry.controlId === null));
  assert.ok(template.missing.includes('future-ui-function'));
});

test('completed overlays must cover the authoritative catalog without a hard-coded test inventory', () => {
  const catalog = loadUiLayerCatalog();
  const template = buildUiLayerHardwareTemplate('tm-mfd', catalog, { deviceInstance: 'MFD3' });
  assert.equal(template.status, 'complete');
  assert.deepEqual(
    new Set(template.functions.map((entry) => entry.id)),
    new Set(catalog.functions.map((entry) => entry.id)),
  );
  assert.ok(template.functions.every((entry) => entry.controlId));
});

test('instance-scoped overlays apply only to their configured hardware instance', () => {
  const catalog = loadUiLayerCatalog();

  for (const deviceInstance of ['MFD1', 'MFD2']) {
    const result = composeUiLayerLabels('tm-mfd', {}, { catalog, deviceInstance });
    assert.equal(result.template.status, 'not-applicable', deviceInstance);
    assert.deepEqual(result.labels, {}, deviceInstance);
    assert.equal(result.legend, null, deviceInstance);
  }

  const mfd3 = composeUiLayerLabels('tm-mfd', {}, { catalog, deviceInstance: 'MFD3' });
  assert.equal(mfd3.template.status, 'complete');
  assert.ok(Object.values(mfd3.labels).flat().some((entry) => entry.source === 'ui-layer'));
  assert.equal(mfd3.legend?.source, 'ui-layer');
});

test('UI Layer and aircraft labels coexist on the same hardware control', () => {
  const catalog = loadUiLayerCatalog();
  const result = composeUiLayerLabels('vkb-f14-gunfighter', {
    'vkb-paddle': 'F-14 NWS / Aerial Refueling Disconnect',
  }, { catalog });
  const labels = result.labels['vkb-paddle'];
  assert.equal(labels[0].label, 'F-14 NWS / Aerial Refueling Disconnect');
  assert.ok(labels.some((entry) => entry.functionId === 'recenter-vr'));
});

test('aliases resolve to their one canonical shared Draw.io hardware definition', () => {
  const catalog = loadUiLayerCatalog();
  const template = buildUiLayerHardwareTemplate('ava-base-f16c', catalog);
  assert.equal(template.deviceId, 'tm-warthog-grip');
});


test('canonical UI Layer input payload is complete and agrees with the function catalog', () => {
  const catalog = loadUiLayerCatalog({ commonRoot: root });
  const inputRoot = join(root, 'assets', 'shared', 'ui-layer', 'input', 'UiLayer');
  const joystickRoot = join(inputRoot, 'joystick');
  assert.ok(existsSync(join(inputRoot, 'modifiers.lua')));
  const profiles = readdirSync(joystickRoot).filter((file) => file.endsWith('.diff.lua'));
  assert.ok(profiles.length > 0, 'expected migrated UI Layer joystick profiles');
  const commands = new Set(catalog.functions.map((entry) => entry.command));
  for (const profile of profiles) {
    const source = readFileSync(join(joystickRoot, profile), 'utf8');
    for (const match of source.matchAll(/\["(d[^"]+)"\]\s*=\s*\{/g)) {
      assert.ok(commands.has(match[1]), `${profile}: unknown UI Layer command ${match[1]}`);
    }
  }
});


test('UI Layer legend exists only when a modifier is in use', () => {
  const catalog = loadUiLayerCatalog({ commonRoot: root });
  const active = composeUiLayerLabels('vkb-f14-gunfighter', {}, { catalog });
  assert.equal(active.legend?.modifierId, 'VKB_F14_BTN7');
  assert.match(active.legend?.label ?? '', /UI Layer/);

  assert.equal(composeUiLayerLabels('winctrl-icp', {}, { catalog }).legend, null);
  assert.equal(composeUiLayerLabels('tm-tpr', {}, { catalog }).legend, null);
});
