import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfileDrivenConfig, parseDcsDiffLua } from '../scripts/profile-driven-kneeboard.mjs';

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = join(commonRoot, 'examples', 'f14-autopilot-mapping');

function parsedProfile(filename) {
  return parseDcsDiffLua(readFileSync(join(exampleRoot, 'profiles', filename), 'utf8')).bindings;
}

function addedBindings(bindings) {
  return bindings.flatMap((binding) => binding.added.map((input) => ({
    ...input,
    command: binding.command,
    name: binding.name,
    chord: input.reformers.join('+'),
  })));
}

test('F-14 autopilot fixture assigns every physical chord once', () => {
  const bindings = addedBindings([
    ...parsedProfile('proposed-f14-pilot.diff.lua'),
    ...parsedProfile('proposed-vkb-f14.diff.lua'),
  ]);
  const assignments = new Set();
  for (const binding of bindings) {
    const device = binding.command.includes('cd57') || binding.command.includes('cd18') ? 'vkb' : 'throttle';
    const assignment = `${device}:${binding.key}:${binding.chord}`;
    assert.ok(!assignments.has(assignment), `duplicate assignment: ${assignment}`);
    assignments.add(assignment);
  }

  assert.deepEqual(bindings.map(({ name }) => name).sort(), [
    'Altitude Hold On, else Off',
    'Autopilot Emergency Disconnect Paddle',
    'Autopilot Heading GT, else Off',
    'Autopilot Heading Toggle On',
    'Autopilot On, else Off',
    'Autopilot Reference / Nosewheel Steering Toggle',
    'Autopilot Vector ACL, else Off',
    'Autopilot Vector VEC/PCD, else Off',
    'Catapult Salute',
  ].sort());
});

test('fixture removes bindings displaced by the canonical mapping', () => {
  const throttle = parsedProfile('proposed-f14-pilot.diff.lua');
  const grip = parsedProfile('proposed-vkb-f14.diff.lua');
  const removed = [...throttle, ...grip].flatMap((binding) => binding.removed.map((input) => ({
    name: binding.name,
    key: input.key,
    chord: input.reformers.join('+'),
  })));

  assert.deepEqual(removed, [
    { name: 'Autopilot Vector VEC/PCD, else Off', key: 'JOY_BTN27', chord: '' },
    { name: 'Autopilot toggle', key: 'JOY_BTN26', chord: '' },
    { name: 'Catapult Salute', key: 'JOY_BTN6', chord: '' },
  ]);
});

test('maintained Warthog switches use deterministic press and release commands', () => {
  const byName = new Map(parsedProfile('proposed-f14-pilot.diff.lua').map((binding) => [binding.name, binding.command]));
  assert.match(byName.get('Autopilot On, else Off'), /^d3040p.+u3040cd22vd1.+vu-1$/);
  assert.match(byName.get('Altitude Hold On, else Off'), /^d3038p.+u3038cd22vd1.+vu-1$/);
  assert.match(byName.get('Autopilot Heading GT, else Off'), /^d3042p.+u3042cd22vd1.+vu0$/);
  assert.match(byName.get('Autopilot Vector VEC\/PCD, else Off'), /^d3039p.+u3039cd22vd-1.+vu0$/);
  assert.match(byName.get('Autopilot Vector ACL, else Off'), /^d3039p.+u3039cd22vd1.+vu0$/);
  assert.equal(byName.get('Autopilot Heading Toggle On'), 'd3744pnilunilcd22vd1vpnilvunil');
});

test('emergency disconnect is direct and displaced salute is BTN7 shifted', () => {
  const bindings = addedBindings(parsedProfile('proposed-vkb-f14.diff.lua'));
  const paddle = bindings.filter(({ key }) => key === 'JOY_BTN6');
  assert.deepEqual(paddle.map(({ name, chord }) => ({ name, chord })), [
    { name: 'Catapult Salute', chord: 'JOY_BTN7' },
    { name: 'Autopilot Emergency Disconnect Paddle', chord: '' },
  ]);
});

test('kneeboard resolves base and BTN7 labels on shared physical callouts', () => {
  const config = loadProfileDrivenConfig('kneeboard.json', {
    consumerRoot: exampleRoot,
    commonRoot,
  });
  const throttle = config.pages.find(({ deviceId }) => deviceId === 'tm-warthog-throttle');
  const grip = config.pages.find(({ deviceId }) => deviceId === 'vkb-f14-gunfighter');

  assert.deepEqual(throttle.labels['warthog-thr-ap-select-up'].map(({ fullLabel }) => fullLabel), [
    'BASE — Autopilot Heading GT, else Off',
    'BTN7 — Autopilot Vector VEC/PCD, else Off',
  ]);
  assert.deepEqual(grip.labels['vkb-paddle'].map(({ fullLabel }) => fullLabel), [
    'BASE — Autopilot Emergency Disconnect Paddle',
    'BTN7 — Catapult Salute',
  ]);
  assert.equal(grip.labels['vkb-nws'], 'SHIFT / MODIFIER');
  assert.equal(grip.modifiers[0].mode, 'hold');
});
