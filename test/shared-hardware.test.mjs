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


const completeCatalogs = [];
const legacyCatalogs = [];

for (const device of manifest.devices) {
  const lua = readFileSync(join(root, 'assets', 'shared', 'hardware', device.lua), 'utf8');
  if (!/schemaVersion\s*=\s*1/.test(lua)) {
    legacyCatalogs.push(device.id);
    continue;
  }

  const catalogId = lua.match(/\bid\s*=\s*"([^"]+)"/)?.[1];
  assert.equal(catalogId, device.id, `${device.id} Lua catalog ID must match its manifest ID`);
  assert.doesNotMatch(lua, /\bcommand\s*=/, `${device.id} shared hardware must not contain aircraft commands`);

  const controls = [...lua.matchAll(
    /\{\s*id = "([^"]+)",\s*key = "([^"]+)",\s*type = "([^"]+)",\s*hardwareLabel = "([^"]+)"/g,
  )].map((match) => ({ id: match[1], key: match[2], type: match[3], hardwareLabel: match[4] }));
  assert.ok(controls.length > 0, `${device.id} schema-versioned catalog must define physical controls`);

  const ids = controls.map(({ id }) => id);
  const keys = controls.map(({ key }) => key);
  assert.equal(new Set(ids).size, ids.length, `${device.id} physical control IDs must be unique`);
  assert.equal(new Set(keys).size, keys.length, `${device.id} physical input keys must be unique`);
  for (const control of controls) {
    assert.ok(control.id && control.key && control.type && control.hardwareLabel,
      `${device.id} controls require id, key, type, and hardwareLabel`);
  }

  const drawio = readFileSync(join(root, 'assets', 'shared', 'hardware', device.drawio), 'utf8');
  const svg = readFileSync(join(root, 'assets', 'shared', 'hardware', device.svg), 'utf8');
  const luaIds = [...ids].sort();
  const drawioIds = [...drawio.matchAll(/id="connector-([^"]+)"/g)].map((match) => match[1]).sort();
  const svgIds = [...svg.matchAll(/<!-- callout:([^\s]+) -->/g)].map((match) => match[1]).sort();
  assert.deepEqual(luaIds, drawioIds, `${device.id} Lua controls must match draw.io connector IDs`);
  assert.deepEqual(luaIds, svgIds, `${device.id} Lua controls must match exported SVG callout IDs`);

  if (device.id === 'tm-mfd') {
    assert.equal(controls.length, 28, 'TM MFD must define all 28 physical controls');
    assert.deepEqual(
      keys.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
      Array.from({ length: 28 }, (_, index) => `JOY_BTN${index + 1}`),
      'TM MFD must define JOY_BTN1 through JOY_BTN28 exactly once',
    );
    assert.equal(controls.filter(({ type }) => type === 'button').length, 20,
      'TM MFD must define 20 OSB buttons');
    assert.equal(controls.filter(({ type }) => type === 'rocker-position').length, 8,
      'TM MFD must define eight rocker positions');
  }

  completeCatalogs.push(device.id);
}

assert.ok(completeCatalogs.includes('tm-mfd'), 'TM MFD must remain a complete schema-versioned catalog');
console.log(`Validated complete physical catalogs: ${completeCatalogs.join(', ')}`);
console.log(`Legacy incomplete physical catalogs: ${legacyCatalogs.join(', ')}`);
