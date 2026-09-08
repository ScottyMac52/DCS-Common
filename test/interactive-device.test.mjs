import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { interactiveDevice } from '../scripts/render-interactive-device.mjs';
import { buildPreview, writeConsumer, stableBindingId, applyDcsCommandAssignments } from '../scripts/scaffold-consumer.mjs';
import { parseDcsDiffLua, loadProfileDrivenConfig } from '../scripts/profile-driven-kneeboard.mjs';

const commonRoot = resolve(import.meta.dirname, '..');
test('interactive geometry covers hardware and aliases, with distinct MFD base/shifted targets', () => {
  const manifest = JSON.parse(readFileSync(join(commonRoot, 'assets/shared/hardware/manifest.json')));
  for (const device of manifest.devices) {
    for (const id of [device.id, ...(device.aliases ?? [])]) {
      const layout = interactiveDevice(id);
      assert.ok(layout.controls.length > 0, id);
      for (const control of layout.controls) {
        assert.ok(control.width > 0 && control.height > 0, control.id);
        assert.ok(Number.isFinite(control.x) && Number.isFinite(control.y), control.id);
      }
      assert.doesNotMatch(layout.background, /<text\b[^>]*id="lbl-/);
    }
  }
  const mfd = interactiveDevice('tm-mfd');
  const base = mfd.controls.find(control => control.id === 'mfd-osb-t1');
  const shifted = mfd.controls.find(control => control.id === 'mfd-osb-t1-shifted');
  assert.equal(base.key, shifted.key);
  assert.notEqual(base.y, shifted.y);
  assert.equal(base.width, 68);
  assert.equal(shifted.width, 55);
});

function fixture(source = 'local diff = {} return diff') {
  const root = mkdtempSync(join(tmpdir(), 'interactive-controls-'));
  const profilesDir = join(root, 'profiles'); mkdirSync(profilesDir);
  const profileFile = 'F16 MFD 1.diff.lua';
  writeFileSync(join(profilesDir, profileFile), source);
  return { root, profilesDir, profileFile, outputDir: join(root, 'out'), displayName: 'Test', inputModuleId: 'Test', kneeboardId: 'Test', commonRoot };
}

test('empty hardware control creation writes a profile and preserves a blank custom label', () => {
  const f = fixture();
  const assignment = { profileFile: f.profileFile, section: 'keyDiffs', key: 'JOY_BTN1', reformers: [], command: 'd-new', name: 'New', allowCreate: true };
  const labelsPath = join(f.root, 'labels.json');
  writeFileSync(labelsPath, JSON.stringify({ [stableBindingId({ ...assignment, chord: '' })]: '' }));
  const preview = buildPreview({ ...f, labelsPath });
  writeConsumer({ ...f, preview, assignments: [assignment] });
  assert.equal(readFileSync(join(f.profilesDir, f.profileFile), 'utf8'), 'local diff = {} return diff');
  const written = parseDcsDiffLua(readFileSync(join(f.outputDir, 'src/Config/Input/Test/joystick', f.profileFile), 'utf8')).bindings;
  assert.equal(written[0].added[0].key, 'JOY_BTN1');
  const config = JSON.parse(readFileSync(join(f.outputDir, 'config/kneeboard.json')));
  const control = config.pages[0].controls['mfd-osb-t1'];
  assert.equal(control.command, 'd-new');
  assert.equal(config.labels[control.labelId], '');
  assert.doesNotThrow(() => loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot: f.outputDir, commonRoot }));
});

test('unknown controls and axis/button mismatches fail before destination writes', () => {
  for (const [key, section] of [['JOY_BTN999', 'keyDiffs'], ['JOY_BTN1', 'axisDiffs']]) {
    const f = fixture();
    const preview = buildPreview(f);
    assert.throws(() => writeConsumer({ ...f, preview, assignments: [{ profileFile: f.profileFile, section, key, command: 'd-new', name: 'New', allowCreate: true }] }), /hardware catalog/);
    assert.equal(existsSync(f.outputDir), false);
  }
});

test('clear removes only the selected chord and records a DCS removal', () => {
  const source = 'local diff = { ["keyDiffs"] = { ["d-old"] = { ["name"]="Old", ["added"] = { [1] = { ["key"]="JOY_BTN1" }, [2] = { ["key"]="JOY_BTN1", ["reformers"]={ [1]="SHIFT" } } } } } } return diff';
  const result = applyDcsCommandAssignments(source, [{ section: 'keyDiffs', key: 'JOY_BTN1', reformers: [], clear: true }]);
  const binding = parseDcsDiffLua(result).bindings[0];
  assert.deepEqual(binding.added, [{ key: 'JOY_BTN1', reformers: ['SHIFT'] }]);
  assert.deepEqual(binding.removed, [{ key: 'JOY_BTN1', reformers: [] }]);
});

test('replacement retains its edited label after the command changes', () => {
  const f = fixture('local diff = { ["keyDiffs"] = { ["d-old"] = { ["name"]="Old", ["added"] = { [1] = { ["key"]="JOY_BTN1" } } } } } return diff');
  const assignment = { profileFile: f.profileFile, section: 'keyDiffs', key: 'JOY_BTN1', reformers: [], command: 'd-new', name: 'New' };
  const labelsPath = join(f.root, 'labels.json');
  writeFileSync(labelsPath, JSON.stringify({ [stableBindingId({ ...assignment, chord: '' })]: 'CUSTOM' }));
  writeConsumer({ ...f, preview: buildPreview({ ...f, labelsPath }), assignments: [assignment] });
  const config = JSON.parse(readFileSync(join(f.outputDir, 'config/kneeboard.json')));
  assert.equal(config.labels[config.pages[0].controls['mfd-osb-t1'].labelId], 'CUSTOM');
});

test('a new multi-modifier chord writes its native reformers and shifted callout without replacing base', () => {
  const f = fixture('local diff = { ["keyDiffs"] = { ["d-base"] = { ["name"]="Base", ["added"] = { [1] = { ["key"]="JOY_BTN1" } } } } } return diff');
  const modifiersPath = join(f.root, 'modifiers.lua');
  writeFileSync(modifiersPath, `local modifiers = {
    ["CTRL"] = { ["device"] = "F16 MFD 1", ["key"] = "JOY_BTN27", ["switch"] = false },
    ["SHIFT"] = { ["device"] = "F16 MFD 1", ["key"] = "JOY_BTN28", ["switch"] = false }
  } return modifiers`);
  const preview = buildPreview({ ...f, modifiersPath });
  const assignment = { profileFile: f.profileFile, section: 'keyDiffs', key: 'JOY_BTN1', reformers: ['CTRL', 'SHIFT'], command: 'd-chord', name: 'Chord command', allowCreate: true };
  assert.equal(preview.availableControls.some(row => row.chord === 'CTRL+SHIFT'), false);
  writeConsumer({ ...f, preview, assignments: [assignment] });
  const written = parseDcsDiffLua(readFileSync(join(f.outputDir, 'src/Config/Input/Test/joystick', f.profileFile), 'utf8')).bindings;
  assert.deepEqual(written.find(binding => binding.command === 'd-base').added[0].reformers, []);
  assert.deepEqual(written.find(binding => binding.command === 'd-chord').added[0].reformers, ['CTRL', 'SHIFT']);
  const config = JSON.parse(readFileSync(join(f.outputDir, 'config/kneeboard.json')));
  assert.equal(config.pages[0].layers.find(layer => layer.id === 'base').controls['mfd-osb-t1'].command, 'd-base');
  assert.ok(config.pages[0].layers.some(layer => layer.controls['mfd-osb-t1-shifted']?.command === 'd-chord'));
  assert.doesNotThrow(() => loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot: f.outputDir, commonRoot }));
});
