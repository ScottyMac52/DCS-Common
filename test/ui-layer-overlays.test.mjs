import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUiLayerHardwareTemplate,
  composeUiLayerLabels,
  loadUiLayerCatalog,
  validateUiLayerCatalog,
} from '../scripts/ui-layer-overlays.mjs';

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
  const template = buildUiLayerHardwareTemplate('tm-mfd', catalog);
  assert.equal(template.status, 'complete');
  assert.deepEqual(
    new Set(template.functions.map((entry) => entry.id)),
    new Set(catalog.functions.map((entry) => entry.id)),
  );
  assert.ok(template.functions.every((entry) => entry.controlId));
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
