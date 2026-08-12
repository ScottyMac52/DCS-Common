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

test('all defined hardware devices have native draw.io sources', () => {
  assert.ok(phaseOne.length > 0);
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
      assert.match(xml, /image=data:image\/(?:png|jpeg),[A-Za-z0-9+/=]+(?:;|")/);
      assert.doesNotMatch(xml, /image=data:image\/(?:png|jpeg);base64,/);
    }
  }
});

test('Viper TQS source has independently editable handle and Mission Pack image layers', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/viper-tqs-mission-pack.drawio'), 'utf8');
  assert.equal((xml.match(/id="hardware-image-/g) ?? []).length, 2);
  assert.equal((xml.match(/id="connector-viper-tqs-/g) ?? []).length, 63);
  assert.equal((xml.match(/id="connector-viper-tqs-button-/g) ?? []).length, 57);
  assert.equal((xml.match(/id="connector-viper-tqs-axis-/g) ?? []).length, 6);
  assert.equal((xml.match(/id="label-viper-tqs-[^"]+" value="[^"]+"/g) ?? []).length, 63,
    'every Viper callout must have a default authoring watermark');
  assert.equal((xml.match(/id="label-viper-tqs-button-\d{2}" value="Button \d+ — [^"]+"/g) ?? []).length, 57,
    'every visible Viper button watermark must include its button number and F-16C function');
  assert.equal((xml.match(/id="label-viper-tqs-axis-[^"]+" value="Axis [A-Z]+ — [^"]+"/g) ?? []).length, 6,
    'every Viper axis watermark must include its axis name and F-16C function');
  assert.equal((xml.match(/width="160" height="28"/g) ?? []).length, 63,
    'Viper callouts must match the Logitech Throttle Quadrant width');
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

test('MFD has separate primary and shifted OSB fields plus eight rocker positions', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/tm-mfd.drawio'), 'utf8');
  assert.equal((xml.match(/id="label-mfd-osb-(?![^\"]*-shifted)/g) ?? []).length, 20);
  assert.equal((xml.match(/id="label-mfd-osb-[^\"]+-shifted"/g) ?? []).length, 20);
  assert.equal((xml.match(/id="label-mfd-rocker-/g) ?? []).length, 8);
  assert.equal((xml.match(/id="(?:anchor|connector)-mfd-/g) ?? []).length, 0);
});

test('TM Warthog joystick uses the supplied artwork label fields without callouts', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/tm-warthog-grip.drawio'), 'utf8');
  assert.equal((xml.match(/id="label-warthog-grip-/g) ?? []).length, 25);
  assert.equal((xml.match(/id="(?:anchor|connector)-warthog-grip-/g) ?? []).length, 0);
});

test('Hornet grip definitions use all supplied artwork fields without callouts', () => {
  for (const [file, prefix] of [['grip-f18c.drawio', 'hornet-grip'], ['ava-base-f18c.drawio', 'ava-hornet']]) {
    const xml = readFileSync(join(hardwareRoot, 'drawio', file), 'utf8');
    assert.equal((xml.match(new RegExp(`id="label-${prefix}-`, 'g')) ?? []).length, 29);
    assert.equal((xml.match(new RegExp(`id="(?:anchor|connector)-${prefix}-`, 'g')) ?? []).length, 0);
    assert.match(xml, /image=data:image\/jpeg,[A-Za-z0-9+/=]+/);
  }
});

test('WINCTRL ICP source matches the 34-button and four-axis reference image', () => {
  const xml = readFileSync(join(hardwareRoot, 'drawio/winctrl-icp.drawio'), 'utf8');
  const lua = readFileSync(join(hardwareRoot, 'lua/winctrl-icp.lua'), 'utf8');
  const expectedIds = [
    ...Array.from({ length: 34 }, (_, index) => `winctrl-icp-btn-${String(index + 1).padStart(2, '0')}`),
    'winctrl-icp-axis-x',
    'winctrl-icp-axis-y',
    'winctrl-icp-axis-rx',
    'winctrl-icp-axis-ry',
  ].sort();

  const drawioIds = [...xml.matchAll(/id="connector-(winctrl-icp-[^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const luaIds = [...lua.matchAll(/\{ id = "(winctrl-icp-[^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(drawioIds, expectedIds);
  assert.deepEqual(luaIds, expectedIds);
  for (let button = 1; button <= 34; button += 1) {
    assert.match(lua, new RegExp(`key = "JOY_BTN${button}"`));
  }
  for (const axis of ['JOY_X', 'JOY_Y', 'JOY_RX', 'JOY_RY']) {
    assert.match(lua, new RegExp(`key = "${axis}"`));
  }
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
