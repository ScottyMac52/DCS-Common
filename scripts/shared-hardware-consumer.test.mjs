import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProvenanceFooter, loadSharedHardware, renderSharedHardwareInstancesPage, renderSharedHardwarePage } from '../scripts/shared-hardware-consumer.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('consumer API resolves stable device IDs and fills shared labels', () => {
  const loaded = loadSharedHardware('tm-mfd', { commonRoot, labels: { 'mfd-osb-t1': 'Test binding' } });
  assert.equal(loaded.calloutIds.length, 48);
  assert.match(loaded.svg, /Test binding/);
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

test('callout text fill follows labelColors map', () => {
  const loaded = loadSharedHardware('tm-mfd', {
    commonRoot,
    labels: { 'mfd-osb-t1': 'Shifted OSB' },
    labelColors: { 'mfd-osb-t1': '#dc2626' },
  });
  assert.match(loaded.svg, /id="lbl-mfd-osb-t1"[^>]*fill="#dc2626"/);
  assert.match(loaded.svg, /Shifted OSB/);
});

test('page SVG includes shift legend when legend entries provided', () => {
  const rendered = renderSharedHardwarePage({
    deviceId: 'tm-mfd',
    labels: { 'mfd-osb-t1': 'Markpoint' },
    labelColors: { 'mfd-osb-t1': '#dc2626' },
    legend: [
      { label: 'Base (no modifier)', fill: '#111827' },
      { label: 'S3 (hold)', fill: '#dc2626' },
    ],
    title: 'LEFT MFD',
    commonRoot,
  });
  assert.match(rendered.svg, /data-modifier-legend="true"/);
  assert.match(rendered.svg, /SHIFT \/ MODIFIER/);
  assert.match(rendered.svg, /S3 \(hold\)/);
  assert.match(rendered.svg, /#dc2626/);
  assert.match(rendered.svg, /<image[^>]*height="1170"/);
  assert.match(rendered.svg, /<g data-modifier-legend="true">[\s\S]*?<rect x="54" y="1350"/);
});
