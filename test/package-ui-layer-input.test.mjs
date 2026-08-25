import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { packageUiLayerInput, physicalDeviceName, tailorModifiers } from '../scripts/package-ui-layer-input.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('physicalDeviceName ignores GUID, spacing, and case', () => {
  assert.equal(
    physicalDeviceName(' VKBSim Gunfighter F14   {2D5CEC70-5189-11f1-8001-444553540000}.diff.lua'),
    'vkbsim gunfighter f14',
  );
});

test('tailorModifiers keeps keyboard plus modifiers for active hardware only', () => {
  const source = readFileSync(join(root, 'assets/shared/ui-layer/input/UiLayer/modifiers.lua'), 'utf8');
  const tailored = tailorModifiers(source, new Set(['Ava [R] Viper']));
  assert.match(tailored, /\["LShift"\]/);
  assert.match(tailored, /\["TM_AVA_BASE_F16_MODIFIER"\]/);
  assert.doesNotMatch(tailored, /\["VKB_F14_BTN7"\]/);
  assert.doesNotMatch(tailored, /\["MOZA_F16_F18_BTN3"\]/);
});

test('packageUiLayerInput includes only UI Layer profiles matching the consumer module hardware', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dcs-ui-layer-package-'));
  const consumerJoystick = join(temp, 'consumer');
  const destination = join(temp, 'UiLayer');
  mkdirSync(consumerJoystick, { recursive: true });
  writeFileSync(
    join(consumerJoystick, 'Ava [R] Viper {11111111-1111-1111-1111-111111111111}.diff.lua'),
    'local diff = {}\nreturn diff\n',
  );
  writeFileSync(
    join(consumerJoystick, 'Unrelated Device {22222222-2222-2222-2222-222222222222}.diff.lua'),
    'local diff = {}\nreturn diff\n',
  );

  const result = packageUiLayerInput({ commonRoot: root, consumerJoystickDir: consumerJoystick, destination });
  assert.equal(result.copiedProfiles.length, 1);
  assert.match(result.copiedProfiles[0], /Ava \[R\] Viper/);
  assert.deepEqual(readdirSync(join(destination, 'joystick')), result.copiedProfiles);
  const modifiers = readFileSync(join(destination, 'modifiers.lua'), 'utf8');
  assert.match(modifiers, /TM_AVA_BASE_F16_MODIFIER/);
  assert.doesNotMatch(modifiers, /VKB_F14_BTN7/);
});
