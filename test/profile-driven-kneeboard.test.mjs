import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadProfileDrivenConfig, parseDcsDiffLua, parseDcsModifiersLua } from '../scripts/profile-driven-kneeboard.mjs';

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

const modifiersSource = `local modifiers = {
  ["AVA_F16_S3"] = { ["device"] = "Ava Viper {GUID}", ["key"] = "JOY_BTN3", ["switch"] = false },
  ["LShift"] = { ["device"] = "Keyboard", ["key"] = "LShift", ["switch"] = false },
  ["MODE"] = { ["device"] = "Panel {GUID}", ["key"] = "JOY_BTN30", ["switch"] = true },
}
return modifiers`;

test('parses held and switched native DCS modifiers', () => {
  assert.deepEqual(parseDcsModifiersLua(modifiersSource).modifiers, [
    { name: 'AVA_F16_S3', device: 'Ava Viper {GUID}', key: 'JOY_BTN3', mode: 'hold' },
    { name: 'LShift', device: 'Keyboard', key: 'LShift', mode: 'hold' },
    { name: 'MODE', device: 'Panel {GUID}', key: 'JOY_BTN30', mode: 'toggle' },
  ]);
});

test('expands base and S3 layers and resolves the same OSB by exact modifier chord', () => {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'dcs-modifiers-'));
  mkdirSync(join(consumerRoot, 'profiles'));
  writeFileSync(join(consumerRoot, 'modifiers.lua'), modifiersSource);
  writeFileSync(join(consumerRoot, 'profiles/mfd.diff.lua'), `local diff = { ["keyDiffs"] = {
    ["base"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Left MFD OSB 1", },
    ["shifted"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1", ["reformers"] = { [1] = "AVA_F16_S3" } }, }, ["name"] = "Markpoint shortcut", },
  } } return diff`);
  writeFileSync(join(consumerRoot, 'kneeboard.json'), JSON.stringify({
    schemaVersion: 1, aircraft: 'F-16C', modifiersFile: 'modifiers.lua',
    modifiers: { S3: { nativeName: 'AVA_F16_S3', deviceId: 'ava-base-f16c', mode: 'hold' } },
    profiles: { left: 'profiles/mfd.diff.lua' },
    pages: [{ file: '02-LEFT-MFD', deviceId: 'tm-mfd', title: 'LEFT MFD', layers: [
      { id: 'base', controls: { 'mfd-osb-t1': { profile: 'left', key: 'JOY_BTN1' } } },
      { id: 's3', file: '03-S3-LEFT-MFD', title: 'S3 HELD • LEFT MFD', modifiers: ['S3'], controls: { 'mfd-osb-t1': { profile: 'left', key: 'JOY_BTN1' } } },
    ] }],
  }));
  const config = loadProfileDrivenConfig('kneeboard.json', { consumerRoot, commonRoot: resolve(import.meta.dirname, '..') });
  assert.equal(config.pages[0].labels['mfd-osb-t1'], 'Left MFD OSB 1');
  assert.equal(config.pages[1].labels['mfd-osb-t1'], 'Markpoint shortcut');
  assert.equal(config.pages[1].modifiers[0].mode, 'hold');
});

test('rejects ambiguous bindings for the same key and modifier chord', () => {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'dcs-modifier-conflict-'));
  writeFileSync(join(consumerRoot, 'profile.diff.lua'), `local diff = { ["keyDiffs"] = {
    ["one"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "One", },
    ["two"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" }, }, ["name"] = "Two", },
  } } return diff`);
  writeFileSync(join(consumerRoot, 'kneeboard.json'), JSON.stringify({ schemaVersion: 1, aircraft: 'Test', profiles: { p: 'profile.diff.lua' }, pages: [{ file: 'mfd', deviceId: 'tm-mfd', controls: { 'mfd-osb-t1': { profile: 'p', key: 'JOY_BTN1' } } }] }));
  assert.throws(() => loadProfileDrivenConfig('kneeboard.json', { consumerRoot, commonRoot: resolve(import.meta.dirname, '..') }), /resolves to 2 bindings/);
});
