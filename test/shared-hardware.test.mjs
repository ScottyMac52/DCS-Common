import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const manifestPath = join(root, 'assets', 'shared', 'hardware', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const workflow = readFileSync(join(root, '.github', 'workflows', 'main.yml'), 'utf8');
const mockConfigSource = workflow.match(/@"\r?\n([\s\S]*?)\r?\n\s*"@/)?.[1];
assert.ok(mockConfigSource, 'main.yml must contain the embedded kneeboard JSON mock');
const mockConfig = JSON.parse(mockConfigSource);
const synchronizedWatermarkDevices = new Set([
  'onyourtwelve-pdcp',
  'moza-ab9',
  'tm-mfd',
  'winctrl-pto2',
]);

assert.ok(Array.isArray(manifest.devices), 'manifest should contain a devices array');
assert.equal(manifest.devices.length, 14, 'expected 14 shared hardware definitions');

for (const device of manifest.devices) {
  const svgPath = join(root, 'assets', 'shared', 'hardware', device.svg);
  const luaPath = join(root, 'assets', 'shared', 'hardware', device.lua);
  assert.ok(existsSync(svgPath), `${device.id} is missing its SVG asset`);
  assert.ok(existsSync(luaPath), `${device.id} is missing its Lua definition`);
}

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

{
  const device = manifest.devices.find(({ id }) => id === 'vkb-f14-gunfighter');
  const drawio = readFileSync(join(root, 'assets', 'shared', 'hardware', device.drawio), 'utf8');
  const svg = readFileSync(join(root, 'assets', 'shared', 'hardware', device.svg), 'utf8');
  const hardwareRoot = join(root, 'assets', 'shared', 'hardware');
  assert.ok(existsSync(join(hardwareRoot, 'source', 'vkb-f14-grip-side.png')),
    'VKB F-14 side-view authoring source is missing');
  assert.ok(existsSync(join(hardwareRoot, 'source', 'vkb-f14-grip-rear.png')),
    'VKB F-14 rear-view authoring source is missing');
  assert.ok(!existsSync(join(hardwareRoot, 'source', 'vkb-grip-clean.png')),
    'The superseded single-view VKB F-14 image must be removed');
  assert.equal([...drawio.matchAll(/id="hardware-image-/g)].length, 2,
    'VKB F-14 draw.io must contain both supplied image views');
  assert.equal([...svg.matchAll(/<image\b/g)].length, 2,
    'VKB F-14 SVG must render both supplied image views');

  const expectedIds = [
    'vkb-trigger', 'vkb-btn-release', 'vkb-pinky', 'vkb-btn-dlc',
    'vkb-nws', 'vkb-hat', 'vkb-sw1', 'vkb-sw2', 'vkb-sw3',
    'vkb-sw4', 'vkb-axis-dlc',
  ];
  const drawioIds = [...drawio.matchAll(/id="connector-([^"]+)"/g)].map((match) => match[1]);
  const svgIds = [...svg.matchAll(/<!-- (?:callout|box):([^\s]+) -->/g)].map((match) => match[1]);
  assert.deepEqual([...drawioIds].sort(), [...expectedIds].sort(),
    'VKB F-14 draw.io must contain each stable callout exactly once');
  assert.deepEqual([...svgIds].sort(), [...expectedIds].sort(),
    'VKB F-14 SVG must contain each stable callout exactly once');

  const geometry = (id) => {
    const match = drawio.match(new RegExp(
      `<mxCell id="${id}"[^>]*>[\\s\\S]*?<mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
    ));
    assert.ok(match, `VKB F-14 draw.io is missing geometry for ${id}`);
    return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
  };
  const images = ['hardware-image-1', 'hardware-image-2'].map(geometry);
  const overlaps = (a, b) => !(
    a.x + a.width <= b.x || b.x + b.width <= a.x ||
    a.y + a.height <= b.y || b.y + b.height <= a.y
  );
  for (const id of expectedIds) {
    const label = geometry(`label-${id}`);
    assert.ok(images.every((image) => !overlaps(label, image)),
      `VKB F-14 ${id} label box must remain outside both images`);
    const anchor = geometry(`anchor-${id}`);
    const center = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
    assert.ok(images.some((image) => (
      center.x >= image.x && center.x <= image.x + image.width &&
      center.y >= image.y && center.y <= image.y + image.height
    )), `VKB F-14 ${id} anchor must terminate on one supplied image`);
  }
  const anchorCenters = expectedIds.map((id) => {
    const anchor = geometry(`anchor-${id}`);
    return `${anchor.x + anchor.width / 2},${anchor.y + anchor.height / 2}`;
  });
  assert.equal(new Set(anchorCenters).size, expectedIds.length,
    'VKB F-14 callouts must not repeat a physical anchor');

  for (const group of [
    ['vkb-hat', 'vkb-btn-release'],
    ['vkb-pinky', 'vkb-sw1', 'vkb-sw2', 'vkb-sw3', 'vkb-sw4'],
    ['vkb-axis-dlc', 'vkb-btn-dlc', 'vkb-nws'],
  ]) {
    const positions = group.map((id) => geometry(`label-${id}`));
    assert.ok(positions.every(({ x }) => x === positions[0].x),
      `VKB F-14 related callouts must share one column: ${group.join(', ')}`);
    assert.ok(positions.slice(1).every(({ y }, index) => y - positions[index].y === 50),
      `VKB F-14 related callouts must be contiguous: ${group.join(', ')}`);
  }
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
  const allowSharedIds = new Set(['vkb-f14-gunfighter', 'tm-warthog-throttle']);
  if (!allowSharedIds.has(device.id)) {
    assert.equal(new Set(ids).size, ids.length, `${device.id} physical control IDs must be unique`);
  }
  if (!allowSharedIds.has(device.id)) {
    assert.equal(new Set(keys).size, keys.length, `${device.id} physical input keys must be unique`);
  }
  for (const control of controls) {
    assert.ok(control.id && control.key && control.type && control.hardwareLabel,
      `${device.id} controls require id, key, type, and hardwareLabel`);
  }

  const drawio = readFileSync(join(root, 'assets', 'shared', 'hardware', device.drawio), 'utf8');
  const svg = readFileSync(join(root, 'assets', 'shared', 'hardware', device.svg), 'utf8');
  const luaIds = [...ids].sort();
  const labelBasedDrawio = new Set(['tm-warthog-throttle']);
  const drawioIdPattern = labelBasedDrawio.has(device.id)
    ? /id="label-([^"]+)"/g
    : /id="connector-([^"]+)"/g;
  const drawioIds = [...drawio.matchAll(drawioIdPattern)].map((match) => match[1]).sort();
  const svgIds = [...svg.matchAll(/<!-- (?:callout|box):([^\s]+) -->/g)].map((match) => match[1]).sort();
  const skipIdMatch = new Set(['tm-warthog-grip', 'grip-f18c', 'ava-base-f16c', 'ava-base-f18c', 'logitech-throttle-quadrant', 'viper-tqs-mission-pack']);
  if (!skipIdMatch.has(device.id)) {
    const luaUnique = [...new Set(luaIds)].sort();
    assert.deepEqual(luaUnique, [...new Set(drawioIds)].sort(), `${device.id} Lua controls must match draw.io IDs`);
    assert.deepEqual(luaUnique, [...new Set(svgIds)].sort(), `${device.id} Lua controls must match exported SVG callout/box IDs`);
  }

  if (synchronizedWatermarkDevices.has(device.id)) {
    const drawioLabels = new Map([...drawio.matchAll(/<mxCell\b([^>]*\bid="label-([^"]+)"[^>]*)>/g)].map((match) => {
      const value = match[1].match(/\bvalue="([^"]*)"/)?.[1]
        ?.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
      return [match[2], value];
    }));
    const svgLabels = new Map([...svg.matchAll(/<text id="lbl-([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((match) => [
      match[1],
      match[2].replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
    ]));
    const mockPage = mockConfig.pages.find(({ deviceId }) => deviceId === device.id);
    assert.ok(mockPage, `${device.id} must have a main.yml mock page`);
    assert.deepEqual(Object.keys(mockPage.labels).sort(), [...ids].sort(),
      `${device.id} main.yml mock IDs must match its Lua controls`);
    for (const { id, hardwareLabel } of controls) {
      assert.equal(drawioLabels.get(id), hardwareLabel,
        `${device.id} draw.io watermark must match Lua hardwareLabel for ${id}`);
      assert.equal(svgLabels.get(id), hardwareLabel,
        `${device.id} SVG watermark must match Lua hardwareLabel for ${id}`);
      assert.equal(mockPage.labels[id], hardwareLabel,
        `${device.id} main.yml mock label must match Lua hardwareLabel for ${id}`);
    }
  }

  if (device.id === 'tm-warthog-throttle') {
    assert.equal(controls.length, 41, 'TM Warthog throttle must define 32 buttons, four POV directions, and five axes');
    assert.doesNotMatch(drawio, /id="(?:anchor|connector)-warthog-thr-/, 'TM Warthog draw.io must use the raster callouts without duplicate anchors or connectors');
    assert.equal([...svg.matchAll(/<text id="lbl-warthog-thr-/g)].length, 41,
      'TM Warthog SVG must retain one label placeholder for every control');
    assert.equal([...svg.matchAll(/<!-- (?:callout|box):/g)].length, 41,
      'TM Warthog SVG should contain a callout/box marker for every control');
    const buttonKeys = keys.filter((key) => /^JOY_BTN\d+$/.test(key))
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

  if (device.id === 'viper-tqs-mission-pack') {
    assert.equal(controls.length, 68,
      'Viper TQS + Mission Pack must define 62 button positions and six axes');
    assert.deepEqual(
      keys.filter((key) => /^JOY_BTN\d+$/.test(key)).map((key) => Number(key.slice(7))).sort((a, b) => a - b),
      [...Array.from({ length: 19 }, (_, index) => index + 1), ...Array.from({ length: 43 }, (_, index) => index + 22)],
      'Viper TQS + Mission Pack must define buttons 1-19 and 22-64 exactly once',
    );
    assert.deepEqual(
      keys.filter((key) => /^JOY_(?:X|Y|Z|RX|RY|RZ)$/.test(key)).sort(),
      ['JOY_RX', 'JOY_RY', 'JOY_RZ', 'JOY_X', 'JOY_Y', 'JOY_Z'],
      'Viper TQS + Mission Pack must define all six axes',
    );
    assert.deepEqual(
      [...new Set(drawioIds)].sort(),
      luaIds.filter((id) => !/^viper-tqs-button-0[1-5]$/.test(id)),
      'Viper draw.io must omit only MIC positions 1-5 handled by AutoHotkey',
    );
    assert.deepEqual(
      [...new Set(svgIds)].sort(),
      luaIds.filter((id) => !/^viper-tqs-button-0[1-5]$/.test(id)),
      'Viper SVG must omit only MIC positions 1-5 handled by AutoHotkey',
    );
    assert.equal(controls.filter(({ key, hardwareLabel }) =>
      /^JOY_BTN\d+$/.test(key) && /^Button \d+ — .+/.test(hardwareLabel)).length, 62,
    'Viper button defaults must include both the button number and F-16C function');
    assert.equal(controls.filter(({ key, hardwareLabel }) =>
      /^JOY_(?:X|Y|Z|RX|RY|RZ)$/.test(key) && /^Axis [A-Z]+ — .+/.test(hardwareLabel)).length, 6,
    'Viper axis defaults must include both the axis name and F-16C function');
  }

  if (device.id === 'winctrl-pto2') {
    assert.equal(controls.length, 41, 'WINCTRL PTO2 must define all 41 physical inputs');
    assert.deepEqual(
      keys.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
      Array.from({ length: 41 }, (_, index) => `JOY_BTN${index + 1}`),
      'WINCTRL PTO2 must define JOY_BTN1 through JOY_BTN41 exactly once',
    );
    assert.equal([...drawio.matchAll(/id="label-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 draw.io must have one label for every input');
    assert.equal([...drawio.matchAll(/id="anchor-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 draw.io must have one anchor for every input');
    assert.equal([...drawio.matchAll(/id="connector-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 draw.io must have one connector for every input');
    assert.equal([...drawio.matchAll(/buttonNumber=\d+/g)].length, 41,
      'WINCTRL PTO2 draw.io labels must carry buttonNumber attributes for watermarks');
    assert.equal([...svg.matchAll(/<text id="lbl-pto2-button-/g)].length, 41,
      'WINCTRL PTO2 SVG must retain one label placeholder for every input');
    const imgMatch = drawio.match(/id="hardware-image-1"[^>]*>[\s\S]*?<mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
    assert.ok(imgMatch, 'PTO2 hardware image geometry missing');
    const [ix, iy, iw, ih] = imgMatch.slice(1).map(Number);
    for (let n = 1; n <= 41; n++) {
      const lm = drawio.match(new RegExp(`id="label-pto2-button-${n}"[^>]*>[\\s\\S]*?<mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));
      assert.ok(lm, `missing label geometry for button ${n}`);
      const [lx, ly, lw, lh] = lm.slice(1).map(Number);
      const overlaps = !(lx + lw <= ix || lx >= ix + iw || ly + lh <= iy || ly >= iy + ih);
      assert.ok(!overlaps, `PTO2 label-pto2-button-${n} must stay outside the hardware image`);
    }
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

  if (device.id === 'onyourtwelve-pdcp') {
    assert.equal(controls.length, 29, 'OnYourTwelve PDCP must define all 29 independently exposed inputs');
    assert.deepEqual(
      keys.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
      Array.from({ length: 29 }, (_, index) => `JOY_BTN${index + 1}`),
      'OnYourTwelve PDCP must define JOY_BTN1 through JOY_BTN29 exactly once',
    );
    assert.equal(controls.filter(({ type }) => type === 'button').length, 10,
      'OnYourTwelve PDCP must define ten pushbuttons');
    assert.equal(controls.filter(({ type }) => type === 'switch-position').length, 16,
      'OnYourTwelve PDCP must define sixteen switch positions');
    assert.equal(controls.filter(({ type }) => type === 'rotary-position').length, 3,
      'OnYourTwelve PDCP must define three HSD rotary positions');

    const labelPosition = (id) => {
      const match = drawio.match(new RegExp(
        `<mxCell id="label-${id}"[^>]*><mxGeometry x="([^"]+)" y="([^"]+)"`,
      ));
      assert.ok(match, `OnYourTwelve PDCP is missing label geometry for ${id}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    };
    for (const group of [
      ['pdcp-hud-dec', 'pdcp-hud-analog'],
      ['pdcp-hud-awl', 'pdcp-hud-alt-baro'],
      ['pdcp-vdi-mode', 'pdcp-vdi-tv'],
      ['pdcp-hud-night', 'pdcp-hud-day'],
      ['pdcp-hsd-mode', 'pdcp-hsd-tid', 'pdcp-hsd-ecm-mode'],
      ['pdcp-hsd-ecm', 'pdcp-ecm-on'],
      ['pdcp-pwr-hud', 'pdcp-hud-power-on'],
      ['pdcp-pwr-vdi', 'pdcp-vdi-power-on'],
      ['pdcp-hsd-power-off', 'pdcp-hsd-power-on'],
    ]) {
      const positions = group.map(labelPosition);
      assert.ok(positions.every(({ x }) => x === positions[0].x),
        `OnYourTwelve PDCP grouped positions must share a callout column: ${group.join(', ')}`);
      assert.ok(positions.slice(1).every(({ y }, index) => y - positions[index].y === 48),
        `OnYourTwelve PDCP grouped positions must be contiguous: ${group.join(', ')}`);
    }
  }

  completeCatalogs.push(device.id);
}

assert.ok(completeCatalogs.includes('tm-mfd'), 'TM MFD must remain a complete schema-versioned catalog');
console.log(`Validated complete physical catalogs: ${completeCatalogs.join(', ')}`);
console.log(`Legacy incomplete physical catalogs: ${legacyCatalogs.join(', ')}`);
