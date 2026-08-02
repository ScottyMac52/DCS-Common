import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderKneeboard } from '../scripts/kneeboard-renderer.mjs';
import { config } from '../examples/f14b-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('renders shared SVG pages from a consumer config', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'dcs-common-kneeboard-'));
  const result = await renderKneeboard({ config, outputDir, rootDir: resolve(__dirname, '..') });

  assert.equal(result.svgFiles.length, 2);
  assert.ok(existsSync(join(outputDir, '01-SHARED-OVERVIEW.svg')));
  assert.ok(existsSync(join(outputDir, '02-SAMPLE-HARDWARE.svg')));

  const overview = readFileSync(join(outputDir, '01-SHARED-OVERVIEW.svg'), 'utf8');
  assert.match(overview, /SHARED KNEEBOARD RENDERER/);
  assert.match(overview, /Consumer repos supply page/);
  assert.match(overview, /definitions/);

  const hardware = readFileSync(join(outputDir, '02-SAMPLE-HARDWARE.svg'), 'utf8');
  assert.match(hardware, /SAMPLE HARDWARE PAGE/);
  assert.match(hardware, /Primary action/);

  assert.ok(result.pngFiles.length === 0 || existsSync(join(outputDir, '01-SHARED-OVERVIEW.png')));
});
