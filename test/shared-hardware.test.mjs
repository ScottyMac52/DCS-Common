import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const manifestPath = join(root, 'assets', 'shared', 'hardware', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert.ok(Array.isArray(manifest.devices), 'manifest should contain a devices array');
assert.equal(manifest.devices.length, 14, 'expected 14 shared hardware definitions');

for (const device of manifest.devices) {
  const svgPath = join(root, 'assets', 'shared', 'hardware', device.svg);
  const luaPath = join(root, 'assets', 'shared', 'hardware', device.lua);
  assert.ok(existsSync(svgPath), `${device.id} is missing its SVG asset`);
  assert.ok(existsSync(luaPath), `${device.id} is missing its Lua definition`);
}

// Every device with a source image must embed it (<image> tag) and have callout anchors.
const requiredTemplateAssets = [
  'svg/tm-mfd.svg',
  'svg/onyourtwelve-pdcp.svg',
  'svg/winctrl-pto2.svg',
  'svg/vkb-f14-gunfighter.svg',
  'svg/tm-warthog-throttle.svg',
  'svg/tm-warthog-grip.svg',
  'svg/winctrl-icp.svg',
  'svg/logitech-throttle-quadrant.svg',
  'svg/viper-tqs-mission-pack.svg',
];

for (const relativePath of requiredTemplateAssets) {
  const absolutePath = join(root, 'assets', 'shared', 'hardware', relativePath);
  const contents = readFileSync(absolutePath, 'utf8');
  assert.match(contents, /<image\b/, `${relativePath} should embed the control image`);
  assert.match(contents, /placeholder|hotspot|circle|rect/, `${relativePath} should include placeholder hotspots`);
}

console.log('Shared hardware validation passed.');
