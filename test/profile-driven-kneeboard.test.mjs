import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDcsDiffLua } from '../scripts/profile-driven-kneeboard.mjs';

const source = `local diff = {
  ["axisDiffs"] = {
    ["a1"] = { ["added"] = { [1] = { ["key"] = "JOY_X" }, }, ["name"] = "Roll", },
  },
  ["keyDiffs"] = {
    ["d1"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "SHIFT" } }, }, ["name"] = "Fire", },
    ["d2"] = { ["removed"] = { [1] = { ["key"] = "JOY_BTN2" }, }, ["name"] = "Remove me", },
  },
}
return diff`;

test('parses DCS diff.lua profiles as binding data', () => {
  const { bindings } = parseDcsDiffLua(source);
  assert.deepEqual(bindings, [
    { section: 'keyDiffs', command: 'd1', name: 'Fire', added: [{ key: 'JOY_BTN1', reformers: ['SHIFT'] }], removed: [] },
    { section: 'keyDiffs', command: 'd2', name: 'Remove me', added: [], removed: [{ key: 'JOY_BTN2', reformers: [] }] },
    { section: 'axisDiffs', command: 'a1', name: 'Roll', added: [{ key: 'JOY_X', reformers: [] }], removed: [] },
  ]);
});

test('rejects files that do not return the diff table', () => {
  assert.throws(() => parseDcsDiffLua('return {}'), /return the diff table/);
});
