import test from 'node:test';
import assert from 'node:assert/strict';
import { filterUiLayerProfile, normalizeUiLayerUtilization, utilizedFunctionsForPage } from '../scripts/ui-layer-utilization.mjs';
import { parseDcsDiffLua } from '../scripts/profile-driven-kneeboard.mjs';

const functions = [
  { id: 'one', command: 'd1' },
  { id: 'two', command: 'd2' },
];
const source = `local diff = { ["keyDiffs"] = {
  ["d1"] = { ["added"] = {
    [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "SHIFT_A" } },
    [2] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "SHIFT_B" } },
  }, ["name"] = "One" },
  ["d2"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN2" } }, ["name"] = "Two" },
} } return diff`;

test('utilization validates exact, non-duplicated selections', () => {
  assert.throws(() => normalizeUiLayerUtilization({ mode: 'observed', bindings: [] }), /mode must be explicit/);
  assert.throws(() => normalizeUiLayerUtilization({ mode: 'explicit', bindings: [
    { deviceId: 'tm-mfd', functionId: 'one', modifiers: [] },
    { deviceId: 'tm-mfd', functionId: 'one', modifiers: [] },
  ] }), /Duplicate/);
});

test('profile filtering retains only the explicitly utilized function and chord', () => {
  const utilization = { mode: 'explicit', bindings: [{
    deviceId: 'tm-mfd', deviceInstance: '3', functionId: 'one', modifiers: ['SHIFT_A'],
  }] };
  const filtered = filterUiLayerProfile(source, { utilization, deviceId: 'tm-mfd', deviceInstance: 'MFD3', functions });
  const additions = parseDcsDiffLua(filtered).bindings.flatMap((binding) => binding.added.map((input) => ({ binding, input })));
  assert.equal(additions.length, 1);
  assert.equal(additions[0].binding.command, 'd1');
  assert.deepEqual(additions[0].input.reformers, ['SHIFT_A']);
  assert.deepEqual([...utilizedFunctionsForPage(utilization, 'tm-mfd', 'MFD3')], ['one']);
  assert.deepEqual([...utilizedFunctionsForPage(utilization, 'tm-mfd', 'MFD2')], []);
});
