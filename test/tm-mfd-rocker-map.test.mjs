import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHardwareControls } from '../scripts/generate-complete-build-mock.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const controls = parseHardwareControls(
  readFileSync(join(root, 'assets', 'shared', 'hardware', 'lua', 'tm-mfd.lua'), 'utf8'),
);
const keyById = new Map(controls.map(({ id, key }) => [id, key]));

test('TM MFD rocker button numbers follow their physical sides', () => {
  assert.deepEqual(
    Object.fromEntries([
      'mfd-rocker-sym',
      'mfd-rocker-int',
      'mfd-rocker-con-up',
      'mfd-rocker-con-down',
      'mfd-rocker-brt-up',
      'mfd-rocker-brt-down',
      'mfd-rocker-gain',
      'mfd-rocker-lvl',
    ].map((id) => [id, keyById.get(id)])),
    {
      'mfd-rocker-sym': 'JOY_BTN21',
      'mfd-rocker-int': 'JOY_BTN22',
      'mfd-rocker-con-up': 'JOY_BTN23',
      'mfd-rocker-con-down': 'JOY_BTN24',
      'mfd-rocker-brt-up': 'JOY_BTN25',
      'mfd-rocker-brt-down': 'JOY_BTN26',
      'mfd-rocker-gain': 'JOY_BTN27',
      'mfd-rocker-lvl': 'JOY_BTN28',
    },
  );
});
