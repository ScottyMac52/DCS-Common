import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hardwareRoot = join(root, 'assets/shared/hardware');
const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
const phaseOne = manifest.devices.filter((device) => device.drawio);

test('eight image-backed devices have native draw.io sources', () => {
  assert.equal(phaseOne.length, 8);
  for (const device of phaseOne) {
    const xml = readFileSync(join(hardwareRoot, device.drawio), 'utf8');
    assert.match(xml, /<mxfile\b/);
    assert.match(xml, /compressed="false"/);
    assert.match(xml, /id="hardware-image-1"/);
    assert.match(xml, /image=data:image\/(?:png|jpeg),[A-Za-z0-9+/=]+;/);
    assert.doesNotMatch(xml, /image=data:image\/(?:png|jpeg);base64,/);
    assert.match(xml, /id="anchor-/);
    assert.match(xml, /id="label-/);
    assert.match(xml, /id="connector-/);
    assert.doesNotMatch(xml, /data:image\/svg\+xml/, `${device.id} must not embed the old SVG as a background`);
  }
});

test('native sources and exported SVGs preserve callout identities', () => {
  for (const device of phaseOne) {
    const xml = readFileSync(join(hardwareRoot, device.drawio), 'utf8');
    const svg = readFileSync(join(hardwareRoot, device.svg), 'utf8');
    const sourceIds = [...xml.matchAll(/id="connector-([^"]+)"/g)].map((match) => match[1]).sort();
    const svgIds = [...svg.matchAll(/<!-- callout:([^\s]+) -->/g)].map((match) => match[1]).sort();
    assert.deepEqual(svgIds, sourceIds, `${device.id} callout IDs changed during export`);
    assert.equal((svg.match(/<image\b/g) ?? []).length, (xml.match(/id="hardware-image-/g) ?? []).length);
  }
});

test('MFD pilot has 20 OSBs and eight independently editable rocker positions', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/tm-mfd.drawio'), 'utf8');
  assert.equal((xml.match(/id="anchor-mfd-osb-/g) ?? []).length, 20);
  assert.equal((xml.match(/id="connector-mfd-osb-/g) ?? []).length, 20);
  assert.equal((xml.match(/id="anchor-mfd-rocker-/g) ?? []).length, 8);
  assert.equal((xml.match(/id="connector-mfd-rocker-/g) ?? []).length, 8);
});
