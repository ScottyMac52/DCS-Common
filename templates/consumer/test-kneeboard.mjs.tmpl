import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('build:kneeboard produces source SVG and PNG folders', () => {
  const result = spawnSync('npm', ['run', 'build:kneeboard'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: process.env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, 'kneeboard', 'source')));
  const pngRoot = join(root, 'kneeboard');
  const dirs = readdirSync(pngRoot).filter((name) => name !== 'source');
  assert.ok(dirs.length >= 1, 'expected a kneeboard PNG folder');
});
