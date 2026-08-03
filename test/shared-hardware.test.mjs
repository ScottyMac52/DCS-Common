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


const tmMfdLua = readFileSync(join(root, 'assets', 'shared', 'hardware', 'lua/tm-mfd.lua'), 'utf8');
const tmMfdDrawio = readFileSync(join(root, 'assets', 'shared', 'hardware', 'drawio/tm-mfd.drawio'), 'utf8');
const tmMfdSvg = readFileSync(join(root, 'assets', 'shared', 'hardware', 'svg/tm-mfd.svg'), 'utf8');
const tmMfdControls = [...tmMfdLua.matchAll(
  /\{\s*id = "([^"]+)",\s*key = "(JOY_BTN\d+)",\s*type = "([^"]+)",\s*hardwareLabel = "([^"]+)"/g,
)].map((match) => ({ id: match[1], key: match[2], type: match[3], hardwareLabel: match[4] }));
const tmMfdLuaIds = tmMfdControls.map(({ id }) => id).sort();
const tmMfdDrawioIds = [...tmMfdDrawio.matchAll(/id="connector-([^"]+)"/g)].map((match) => match[1]).sort();
const tmMfdSvgIds = [...tmMfdSvg.matchAll(/<!-- callout:([^\s]+) -->/g)].map((match) => match[1]).sort();

assert.equal(tmMfdControls.length, 28, 'TM MFD must define all 28 physical controls');
assert.equal(new Set(tmMfdLuaIds).size, 28, 'TM MFD control IDs must be unique');
assert.deepEqual(tmMfdLuaIds, tmMfdDrawioIds, 'TM MFD Lua controls must match draw.io connector IDs');
assert.deepEqual(tmMfdLuaIds, tmMfdSvgIds, 'TM MFD Lua controls must match exported SVG callout IDs');
assert.deepEqual(
  tmMfdControls.map(({ key }) => key).sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
  Array.from({ length: 28 }, (_, index) => `JOY_BTN${index + 1}`),
  'TM MFD must define JOY_BTN1 through JOY_BTN28 exactly once',
);
assert.equal(tmMfdControls.filter(({ type }) => type === 'button').length, 20, 'TM MFD must define 20 OSB buttons');
assert.equal(tmMfdControls.filter(({ type }) => type === 'rocker-position').length, 8, 'TM MFD must define eight rocker positions');
assert.doesNotMatch(tmMfdLua, /\bcommand\s*=/, 'Shared TM MFD hardware must not contain aircraft commands');
assert.match(tmMfdLua, /schemaVersion\s*=\s*1/, 'TM MFD physical catalog must declare schema version 1');
