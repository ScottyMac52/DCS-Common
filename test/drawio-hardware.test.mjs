import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hardwareRoot = join(root, 'assets/shared/hardware');
const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
const phaseOne = manifest.devices.filter((device) => device.drawio);

test('all 14 hardware devices have native draw.io sources', () => {
  assert.equal(phaseOne.length, 14);
  for (const device of phaseOne) {
    const xml = readFileSync(join(hardwareRoot, device.drawio), 'utf8');
    assert.match(xml, /<mxfile\b/);
    assert.match(xml, /compressed="false"/);
    assert.match(xml, /id="hardware-image-1"/);
    assert.match(xml, /id="label-/);
    assert.match(xml, /image=data:image\/(?:png|jpeg|jpg),[A-Za-z0-9+/=]+/);
    assert.doesNotMatch(xml, /data:image\/svg\+xml/, `${device.id} must not embed the old SVG as a background`);
    assert.doesNotMatch(readFileSync(join(hardwareRoot, device.svg), 'utf8'), /No source image available/);

    // Callout style requires anchors + connectors; box-only style is labels over artwork.
    const hasConnectors = (xml.match(/id="connector-/g) ?? []).length > 0;
    if (hasConnectors) {
      assert.match(xml, /id="anchor-/);
      assert.match(xml, /image=data:image\/(?:png|jpeg),[A-Za-z0-9+/=]+;/);
      assert.doesNotMatch(xml, /image=data:image\/(?:png|jpeg);base64,/);
    }
  }
});

test('Viper TQS source has independently editable handle and Mission Pack image layers', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/viper-tqs-mission-pack.drawio'), 'utf8');
  assert.equal((xml.match(/id="hardware-image-/g) ?? []).length, 2);
  assert.ok((xml.match(/id="connector-viper-tqs-/g) ?? []).length >= 20);
});

test('native sources and exported SVGs preserve callout identities', () => {
  for (const device of phaseOne) {
    const xml = readFileSync(join(hardwareRoot, device.drawio), 'utf8');
    const svg = readFileSync(join(hardwareRoot, device.svg), 'utf8');
    const hasConnectors = (xml.match(/id="connector-/g) ?? []).length > 0;
    const idPattern = hasConnectors
      ? /id="connector-([^"]+)"/g
      : /id="label-([^"]+)"/g;
    const sourceIds = [...xml.matchAll(idPattern)].map((match) => match[1]).sort();
    const commentPattern = hasConnectors
      ? /<!-- callout:([^\s]+) -->/g
      : /<!-- box:([^\s]+) -->/g;
    const svgIds = [...svg.matchAll(commentPattern)].map((match) => match[1]).sort();
    assert.deepEqual(svgIds, sourceIds, `${device.id} control IDs changed during export`);
    assert.equal((svg.match(/<image\b/g) ?? []).length, (xml.match(/id="hardware-image-/g) ?? []).length);
  }
});


test('published SVGs exactly match the deterministic draw.io exporter', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/export-drawio-hardware.mjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('MFD pilot has 20 OSBs and eight independently editable rocker positions', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/tm-mfd.drawio'), 'utf8');
  assert.equal((xml.match(/id="anchor-mfd-osb-/g) ?? []).length, 20);
  assert.equal((xml.match(/id="connector-mfd-osb-/g) ?? []).length, 20);
  assert.equal((xml.match(/id="anchor-mfd-rocker-/g) ?? []).length, 8);
  assert.equal((xml.match(/id="connector-mfd-rocker-/g) ?? []).length, 8);
});


test('TM MFD visible geometry stays inside a balanced viewport', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/tm-mfd.drawio'), 'utf8');
  const model = xml.match(/<mxGraphModel\b([^>]*)>/)?.[1] ?? '';
  const numberAttribute = (source, name) => Number(source.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? 0);
  const width = numberAttribute(model, 'pageWidth');
  const height = numberAttribute(model, 'pageHeight');
  const cells = [...xml.matchAll(/<mxCell\b([^>]*?)>([\s\S]*?)<\/mxCell>/g)].map((match) => {
    const id = match[1].match(/id="([^"]+)"/)?.[1] ?? '';
    const geometry = match[2].match(/<mxGeometry\b([^>]*)\/>/)?.[1] ?? '';
    return {
      id,
      x: numberAttribute(geometry, 'x'),
      y: numberAttribute(geometry, 'y'),
      width: numberAttribute(geometry, 'width'),
      height: numberAttribute(geometry, 'height'),
    };
  });
  const visible = cells.filter(({ id }) =>
    id === 'hardware-image-1' || id === 'footer' || id.startsWith('anchor-') || id.startsWith('label-'));
  for (const cell of visible) {
    assert.ok(cell.x >= 0 && cell.y >= 0, `${cell.id} starts outside the MFD viewport`);
    assert.ok(cell.x + cell.width <= width, `${cell.id} exceeds the right MFD viewport edge`);
    assert.ok(cell.y + cell.height <= height, `${cell.id} exceeds the bottom MFD viewport edge`);
  }

  const labels = visible.filter(({ id }) => id.startsWith('label-'));
  const left = Math.min(...labels.map(({ x }) => x));
  const right = width - Math.max(...labels.map(({ x, width: labelWidth }) => x + labelWidth));
  assert.ok(left >= 20, 'TM MFD labels need visible left padding');
  assert.ok(right >= 20, 'TM MFD labels need visible right padding');
  assert.ok(Math.abs(left - right) <= 10, 'TM MFD outer margins must remain horizontally balanced');

  const top = labels.filter(({ id }) => id.startsWith('label-mfd-osb-t'));
  const bottom = labels.filter(({ id }) => id.startsWith('label-mfd-osb-b'));
  assert.ok(Math.min(...top.map(({ y }) => y)) >= 20, 'TM MFD top row needs visible padding');
  assert.ok(height - Math.max(...bottom.map(({ y, height: labelHeight }) => y + labelHeight)) >= 20,
    'TM MFD bottom row needs visible padding');

  const image = visible.find(({ id }) => id === 'hardware-image-1');
  assert.ok(image);
  assert.equal(image.x + image.width / 2, width / 2, 'TM MFD hardware image must remain centered');
});
