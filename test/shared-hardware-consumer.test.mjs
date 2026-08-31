import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProvenanceFooter, loadSharedHardware, renderSharedHardwareInstancesPage, renderSharedHardwarePage, renderSharedHardwarePages } from '../scripts/shared-hardware-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('consumer API resolves stable device IDs and fills shared labels', () => {
  const loaded = loadSharedHardware('tm-mfd', { commonRoot, labels: { 'mfd-osb-t1': 'Test binding' } });
  assert.equal(loaded.calloutIds.length, 48);
  assert.match(loaded.svg, /Test binding/);
});

test('consumer API resolves AVA Base + F-16C to the TM Warthog Joystick', () => {
  const loaded = loadSharedHardware('ava-base-f16c', { commonRoot });
  assert.equal(loaded.device.id, 'tm-warthog-grip');
  assert.equal(loaded.calloutIds.length, 25);
  assert.match(loaded.svg, /id="mask-warthog-grip-pinky"/);
  assert.match(loaded.svg, /id="mask-warthog-grip-paddle"/);
});

test('consumer API resolves AVA Base + F/A-18C to the Hornet Grip', () => {
  const loaded = loadSharedHardware('ava-base-f18c', { commonRoot });
  assert.equal(loaded.device.id, 'grip-f18c');
  assert.equal(loaded.calloutIds.length, 29);
});

test('consumer API rejects physical button prefixes in displayed callouts', () => {
  assert.throws(
    () => loadSharedHardware('tm-mfd', { commonRoot, labels: { 'mfd-osb-t1': 'BTN 1: Test binding' } }),
    /without a physical-button prefix/,
  );
});

test('provenance footer identifies DCS-Common and the consumer build', () => {
  const footer = formatProvenanceFooter({ commonRoot, consumer: 'Test Consumer', consumerVersion: '1.2.3', page: '2 / 4' });
  assert.match(footer, /^DCS-Common \S+ • Test Consumer 1\.2\.3 • 2 \/ 4$/);
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

test('dense device output includes large-print binding pages and omits empty callouts', () => {
  const labels = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
    `winctrl-icp-btn-${String(index + 1).padStart(2, '0')}`,
    `Configured function ${index + 1}`,
  ]));
  labels['winctrl-icp-btn-15'] = '';
  const pages = renderSharedHardwarePages({
    deviceId: 'winctrl-icp',
    file: '09-WINCTRL-ICP',
    title: 'WINCTRL ViperAce ICP',
    labels,
    commonRoot,
  });

  assert.equal(pages.length, 3, 'locator plus two readable binding pages');
  assert.deepEqual(pages.map(({ file }) => file), [
    '09-WINCTRL-ICP',
    '09-WINCTRL-ICP-BINDINGS-1',
    '09-WINCTRL-ICP-BINDINGS-2',
  ]);
  assert.match(pages[1].svg, /READABLE BINDINGS 1 \/ 2/);
  assert.match(pages[1].svg, /font-size="30"/);
  assert.match(pages[1].svg, /Configured function 1/);
  assert.match(pages[1].svg, />COM 1<\//, 'uses the friendly hardware label from the Lua catalog');
  assert.doesNotMatch(pages[2].svg, /winctrl-icp-btn-15/);
});
