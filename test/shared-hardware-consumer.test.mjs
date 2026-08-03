import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharedHardware, renderSharedHardwareInstancesPage, renderSharedHardwarePage } from '../scripts/shared-hardware-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('consumer API resolves stable device IDs and fills shared labels', () => {
  const loaded = loadSharedHardware('tm-mfd', { commonRoot, labels: { 'mfd-osb-t1': 'BTN 1: Test binding' } });
  assert.equal(loaded.calloutIds.length, 28);
  assert.match(loaded.svg, /BTN 1: Test binding/);
});

test('one canonical device can be rendered as independently labelled physical instances', () => {
  const rendered = renderSharedHardwareInstancesPage({
    commonRoot,
    title: 'Dual quadrants',
    instances: [
      { instanceId: 'primary', deviceId: 'logitech-throttle-quadrant', title: 'PRIMARY', labels: ['Mixture', 'Propeller', 'Throttle'] },
      { instanceId: 'secondary', deviceId: 'logitech-throttle-quadrant', title: 'SECONDARY', labels: ['Supercharger', 'Unbound', 'Unbound'] },
    ],
  });
  assert.equal(rendered.instances.length, 2);
  assert.deepEqual(rendered.instances.map(({ deviceId }) => deviceId), ['logitech-throttle-quadrant', 'logitech-throttle-quadrant']);
  assert.match(rendered.svg, /primary=logitech-throttle-quadrant/);
  assert.match(rendered.svg, /secondary=logitech-throttle-quadrant/);
  assert.equal((rendered.svg.match(/data:image\/svg\+xml;base64,/g) ?? []).length, 2);
});

test('consumer page embeds the populated shared SVG', () => {
  const rendered = renderSharedHardwarePage({ deviceId: 'moza-ab9', labels: ['Pitch', 'Roll'], commonRoot });
  assert.match(rendered.svg, /data:image\/svg\+xml;base64,/);
  assert.match(rendered.svg, /Shared DCS-Common device: moza-ab9/);
  assert.deepEqual(rendered.calloutIds, ['moza-ab9-pitch-axis', 'moza-ab9-roll-axis']);
});
