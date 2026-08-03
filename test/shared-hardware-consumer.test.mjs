import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharedHardware, renderSharedHardwarePage } from '../scripts/shared-hardware-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('consumer API resolves stable device IDs and fills shared labels', () => {
  const loaded = loadSharedHardware('tm-mfd', { commonRoot, labels: { 'mfd-osb-t1': 'BTN 1: Test binding' } });
  assert.equal(loaded.calloutIds.length, 28);
  assert.match(loaded.svg, /BTN 1: Test binding/);
});

test('consumer page embeds the populated shared SVG', () => {
  const rendered = renderSharedHardwarePage({ deviceId: 'moza-ab9', labels: ['Pitch', 'Roll'], commonRoot });
  assert.match(rendered.svg, /data:image\/svg\+xml;base64,/);
  assert.match(rendered.svg, /Shared DCS-Common device: moza-ab9/);
  assert.deepEqual(rendered.calloutIds, ['moza-ab9-pitch-axis', 'moza-ab9-roll-axis']);
});
