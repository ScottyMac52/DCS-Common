import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(root, 'templates/consumer/test-kneeboard.mjs.tmpl'), 'utf8');

test('consumer test template enforces the documented kneeboard contract', () => {
  assert.match(template, /unexpected SVG page set/);
  assert.match(template, /unexpected PNG page set/);
  assert.match(template, /uses an external resource/);
  assert.match(template, /has the wrong page footer/);
  assert.match(template, /is missing its shared-device marker/);
  assert.match(template, /metadata\.width, 1200/);
  assert.match(template, /metadata\.height, 1600/);
  assert.match(template, /changed during an identical rebuild/);
});
