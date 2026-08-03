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
  const labelBasedDrawio = new Set(['tm-warthog-throttle', 'winctrl-pto2']);
  const drawioIdPattern = labelBasedDrawio.has(device.id)
    ? /id="label-([^"]+)"/g
    : /id="connector-([^"]+)"/g;
  const drawioIds = [...drawio.matchAll(drawioIdPattern)].map((match) => match[1]).sort();
  const svgIds = [...svg.matchAll(/<!-- callout:([^\s]+) -->/g)].map((match) => match[1]).sort();
  assert.deepEqual(luaIds, drawioIds, `${device.id} Lua controls must match draw.io connector IDs`);
  assert.deepEqual(luaIds, svgIds, `${device.id} Lua controls must match exported SVG callout IDs`);

  if (device.id === 'tm-warthog-throttle') {
    assert.equal(controls.length, 41, 'TM Warthog throttle must define 32 buttons, four POV directions, and five axes');
    assert.doesNotMatch(drawio, /id="(?:anchor|connector)-warthog-thr-/, 'TM Warthog draw.io must use the raster callouts without duplicate anchors or connectors');
    assert.equal([...svg.matchAll(/<text id="lbl-warthog-thr-/g)].length, 41,
      'TM Warthog SVG must retain one label placeholder for every control');
    assert.doesNotMatch(svg, /<(?:line|circle)\b|<rect\b[^>]*\bx=/,
      'TM Warthog SVG must not draw duplicate callout paths, dots, or label boxes');
    const buttonKeys = keys.filter((key) => /^JOY_BTN\\d+$/.test(key))
      .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
    assert.deepEqual(
      buttonKeys,
      Array.from({ length: 32 }, (_, index) => `JOY_BTN${index + 1}`),
      'TM Warthog throttle must define JOY_BTN1 through JOY_BTN32 exactly once',
    );
    assert.deepEqual(
      keys.filter((key) => key.startsWith('JOY_POV1_')).sort(),
      ['JOY_POV1_D', 'JOY_POV1_L', 'JOY_POV1_R', 'JOY_POV1_U'],
      'TM Warthog throttle must define all four POV directions',
    );
    assert.deepEqual(
      keys.filter((key) => ['JOY_X', 'JOY_Y', 'JOY_Z', 'JOY_RZ', 'JOY_SLIDER1'].includes(key)).sort(),
      ['JOY_RZ', 'JOY_SLIDER1', 'JOY_X', 'JOY_Y', 'JOY_Z'],
      'TM Warthog throttle must define both throttle axes, slew axes, and friction axis',
    );
    assert.equal(controls.filter(({ type }) => type === 'axis').length, 5,
      'TM Warthog throttle must define five axes');
  }

  if (device.id === 'winctrl-pto2') {
    assert.equal(controls.length, 41, 'WINCTRL PTO2 must define all 41 physical inputs');
    assert.deepEqual(
      keys.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
      Array.from({ length: 41 }, (_, index) => `JOY_BTN${index + 1}`),
      'WINCTRL PTO2 must define JOY_BTN1 through JOY_BTN41 exactly once',
    );
    assert.equal([...drawio.matchAll(/id="label-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 draw.io must retain one aligned label component for every input');
    assert.equal([...svg.matchAll(/<text id="lbl-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 SVG must retain one label placeholder for every input');
  }

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
