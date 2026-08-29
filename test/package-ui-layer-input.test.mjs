import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from '../scripts/profile-driven-kneeboard.mjs';
import {
  hasEffectiveAdditions,
  packageUiLayerInput,
  physicalDeviceName,
  selectedUiLayerModifiers,
  tailorDiffLua,
  tailorModifiers,
} from '../scripts/package-ui-layer-input.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function diffLua({ modifier = null, axis = false, removedOnly = false } = {}) {
  const reformers = modifier ? `\n\t\t\t\t\t["reformers"] = { [1] = "${modifier}" },` : '';
  const list = removedOnly ? 'removed' : 'added';
  const section = axis ? 'axisDiffs' : 'keyDiffs';
  return `local diff = {\n\t["${section}"] = {\n\t\t["command"] = {\n\t\t\t["${list}"] = { [1] = { ["key"] = "JOY_BTN1",${reformers}\n\t\t\t} },\n\t\t\t["name"] = "Test",\n\t\t},\n\t},\n}\nreturn diff\n`;
}

function createConsumer({ profiles, pages, retainNoOpProfiles = [] }) {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'dcs-ui-layer-consumer-'));
  const consumerJoystick = join(consumerRoot, 'src/Config/Input/Test/joystick');
  const stagedJoystick = join(consumerRoot, 'stage/Config/Input/Test/joystick');
  const destination = join(consumerRoot, 'stage/Config/Input/UiLayer');
  mkdirSync(consumerJoystick, { recursive: true });
  mkdirSync(stagedJoystick, { recursive: true });
  mkdirSync(join(consumerRoot, 'config'), { recursive: true });
  const profileMap = {};
  for (const [id, specification] of Object.entries(profiles)) {
    const { filename, source } = specification;
    writeFileSync(join(consumerJoystick, filename), source);
    writeFileSync(join(stagedJoystick, filename), source);
    profileMap[id] = `src/Config/Input/Test/joystick/${filename}`;
  }
  writeFileSync(join(consumerRoot, 'config/kneeboard.json'), JSON.stringify({
    schemaVersion: 1,
    aircraft: 'Test',
    profiles: profileMap,
    pages,
    packaging: { retainNoOpProfiles },
  }));
  return { consumerRoot, consumerJoystick, stagedJoystick, destination };
}

test('physicalDeviceName ignores GUID, spacing, and case', () => {
  assert.equal(physicalDeviceName(' VKBSim Gunfighter F14   {2D5CEC70-5189-11f1-8001-444553540000}.diff.lua'), 'vkbsim gunfighter f14');
});

test('hasEffectiveAdditions distinguishes key, axis, empty, and deletion-only profiles', () => {
  assert.equal(hasEffectiveAdditions(diffLua()), true);
  assert.equal(hasEffectiveAdditions(diffLua({ axis: true })), true);
  assert.equal(hasEffectiveAdditions('local diff = {}\nreturn diff\n'), false);
  assert.equal(hasEffectiveAdditions(diffLua({ removedOnly: true })), false);
});

test('tailorModifiers keeps keyboard and only explicitly selected device modifiers', () => {
  const source = readFileSync(join(root, 'assets/shared/ui-layer/input/UiLayer/modifiers.lua'), 'utf8');
  const tailored = tailorModifiers(source, new Set(['Ava [R] Viper', 'MOZA AB9 FFB Base']), new Set(['TM_AVA_BASE_F16_MODIFIER']));
  assert.match(tailored, /\["LShift"\]/);
  assert.match(tailored, /\["TM_AVA_BASE_F16_MODIFIER"\]/);
  assert.doesNotMatch(tailored, /\["VKB_F14_BTN7"\]/);
  assert.doesNotMatch(tailored, /\["MOZA_F16_F18_BTN3"\]/);
});

test('tailorDiffLua removes dangling alternatives and preserves valid shifted bindings', () => {
  const filename = 'F16 MFD 3 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua';
  const source = readFileSync(join(root, 'assets/shared/ui-layer/input/UiLayer/joystick', filename), 'utf8');
  const tailored = tailorDiffLua(source, new Set(['LShift', 'VKB_F14_BTN7']), { filename });
  const parsed = parseDcsDiffLua(tailored, { filename });
  assert.ok(parsed.bindings.every((binding) => binding.added.every((input) => input.reformers.every((name) => name === 'VKB_F14_BTN7'))));
  assert.match(tailored, /VKB_F14_BTN7/);
  assert.doesNotMatch(tailored, /MOZA_F16_F18_BTN3|TM_AVA_BASE_F16_MODIFIER/);
});

test('package uses configured profiles, removes no-op and stale module files, and closes modifier references', () => {
  const ava = 'Ava [R] Viper {11111111-1111-1111-1111-111111111111}.diff.lua';
  const mfd = 'F16 MFD 3 {C5BE49A0-2342-11ee-8001-444553540000}.diff.lua';
  const stale = ' VKBSim Gunfighter F14   {2D5CEC70-5189-11f1-8001-444553540000}.diff.lua';
  const empty = 'Unrelated Device {22222222-2222-2222-2222-222222222222}.diff.lua';
  const fixture = createConsumer({
    profiles: {
      ava: { filename: ava, source: diffLua() },
      mfd3: { filename: mfd, source: diffLua() },
      stale: { filename: stale, source: diffLua() },
      empty: { filename: empty, source: 'local diff = {}\nreturn diff\n' },
    },
    pages: [
      { deviceId: 'ava-base-f16c', controls: { stick: { profile: 'ava' } } },
      { deviceId: 'tm-mfd', deviceInstance: 'MFD3', controls: { button: { profile: 'mfd3' } } },
      { deviceId: 'unrelated', controls: { unused: { profile: 'empty' } } },
    ],
  });
  const result = packageUiLayerInput({ commonRoot: root, consumerJoystickDir: fixture.consumerJoystick,
    destination: fixture.destination, moduleDestinationJoystick: fixture.stagedJoystick });
  assert.deepEqual(result.activeProfiles, [ava, mfd].sort());
  assert.deepEqual(readdirSync(fixture.stagedJoystick).sort(), [ava, mfd].sort());
  assert.ok(result.skippedProfiles.some(({ filename, reason }) => filename === stale && /not selected/.test(reason)));
  assert.ok(result.skippedProfiles.some(({ filename, reason }) => filename === empty && /no effective/.test(reason)));
  assert.deepEqual(result.availableModifiers.filter((name) => !/^L|^R/.test(name)), ['TM_AVA_BASE_F16_MODIFIER']);
  const packagedMfd = readFileSync(join(fixture.destination, 'joystick', mfd), 'utf8');
  assert.match(packagedMfd, /TM_AVA_BASE_F16_MODIFIER/);
  assert.doesNotMatch(packagedMfd, /VKB_F14_BTN7|MOZA_F16_F18_BTN3/);
});

test('explicit retainNoOpProfiles escape hatch preserves an intentionally empty selected module profile', () => {
  const filename = 'Ava [R] Viper {11111111-1111-1111-1111-111111111111}.diff.lua';
  const fixture = createConsumer({
    profiles: { ava: { filename, source: 'local diff = {}\nreturn diff\n' } },
    pages: [{ deviceId: 'ava-base-f16c', controls: { stick: { profile: 'ava' } } }],
    retainNoOpProfiles: ['ava'],
  });
  const result = packageUiLayerInput({ commonRoot: root, consumerJoystickDir: fixture.consumerJoystick,
    destination: fixture.destination, moduleDestinationJoystick: fixture.stagedJoystick });
  assert.deepEqual(result.activeProfiles, [filename]);
  assert.deepEqual(readdirSync(fixture.stagedJoystick), [filename]);
});

test('stick configuration matrix exposes exactly one device modifier family', () => {
  const cases = [
    { deviceId: 'vkb-f14-gunfighter', filename: ' VKBSim Gunfighter F14   {2D5CEC70-5189-11f1-8001-444553540000}.diff.lua', expected: 'VKB_F14_BTN7' },
    { deviceId: 'moza-ab9-hornet-grip', filename: 'MOZA AB9 FFB Base {71DA6210-432E-11f1-8001-444553540000}.diff.lua', expected: 'MOZA_F16_F18_BTN3' },
    { deviceId: 'moza-ab9-warthog-grip', filename: 'MOZA AB9 FFB Base {71DA6210-432E-11f1-8001-444553540000}.diff.lua', expected: 'MOZA_F16_F18_BTN3' },
    { deviceId: 'ava-base-f16c', filename: 'Ava [R] Viper {F77212B0-00A8-11f1-8001-444553540000}.diff.lua', expected: 'TM_AVA_BASE_F16_MODIFIER' },
  ];
  for (const item of cases) {
    const fixture = createConsumer({ profiles: { stick: { filename: item.filename, source: diffLua() } },
      pages: [{ deviceId: item.deviceId, controls: { stick: { profile: 'stick' } } }] });
    const result = packageUiLayerInput({ commonRoot: root, consumerJoystickDir: fixture.consumerJoystick,
      destination: fixture.destination, moduleDestinationJoystick: fixture.stagedJoystick });
    const deviceModifiers = parseDcsModifiersLua(readFileSync(join(fixture.destination, 'modifiers.lua'), 'utf8')).modifiers
      .filter(({ device }) => device !== 'Keyboard').map(({ name }) => name);
    assert.deepEqual(deviceModifiers, [item.expected], item.deviceId);
  }
});

test('modifier selection is owned by the shared hardware definition', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'assets/shared/hardware/manifest.json'), 'utf8'));
  const overlays = JSON.parse(readFileSync(join(root, 'assets/shared/ui-layer/hardware-overlays.json'), 'utf8'));
  assert.equal(overlays.modifierSelections, undefined);
  assert.equal(manifest.devices.find(({ id }) => id === 'vkb-f14-gunfighter').uiLayerModifier, 'VKB_F14_BTN7');
  assert.equal(
    manifest.devices.find(({ id }) => id === 'tm-warthog-grip').uiLayerModifiers['moza-ab9-warthog-grip'],
    'MOZA_F16_F18_BTN3',
  );
});

test('packaging discovers a newly scaffolded modifier from the hardware catalog', () => {
  const commonRoot = mkdtempSync(join(tmpdir(), 'dcs-ui-layer-catalog-'));
  const hardwareRoot = join(commonRoot, 'assets/shared/hardware');
  mkdirSync(hardwareRoot, { recursive: true });
  writeFileSync(join(hardwareRoot, 'manifest.json'), JSON.stringify({
    devices: [{ id: 'future-stick', aliases: ['future-base-stick'], uiLayerModifiers: { 'future-base-stick': 'FUTURE_SHIFT' } }],
  }));
  assert.deepEqual(
    [...selectedUiLayerModifiers(commonRoot, { pages: [{ deviceId: 'future-base-stick' }] })],
    ['FUTURE_SHIFT'],
  );
});
