import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('OvGME package folder matches the archive basename', () => {
  const build = readFileSync(join(root, 'templates/consumer/Build-OvGME.ps1.tmpl'), 'utf8');
  assert.match(build, /\$archiveBase = "\$pkgName-\$Version-OVGME"/);
  assert.match(build, /\$pkg = Join-Path \$stage \$archiveBase/);
  assert.match(build, /\$zip = Join-Path \$dist "\$archiveBase\.zip"/);
});

test('OvGME validation inspects archive roots and required payloads', () => {
  const validate = readFileSync(join(root, 'templates/consumer/Test-Package.ps1.tmpl'), 'utf8');
  assert.match(validate, /GetFileNameWithoutExtension\(\$leaf\)/);
  assert.match(validate, /Config\/Input\/\{\{INPUT_MODULE_ID\}\}\/joystick\//);
  assert.match(validate, /KNEEBOARD\/\{\{KNEEBOARD_ID\}\}\//);
});
