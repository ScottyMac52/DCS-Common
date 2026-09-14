import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commonRoot = resolve(process.env.DCS_COMMON_ROOT ?? join(root, '.dcs-common'));
const sourceDir = join(root, 'kneeboard', 'source');
const rawConfig = JSON.parse(readFileSync(join(root, 'config/kneeboard.json'), 'utf8'));

const { renderSharedHardwarePages } = await import(
  pathToFileURL(join(commonRoot, 'scripts/shared-hardware-consumer.mjs'))
);
const { aircraftFolderName, loadProfileDrivenConfig } = await import(
  pathToFileURL(join(commonRoot, 'scripts/profile-driven-kneeboard.mjs'))
);

const config = loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot: root, commonRoot });
const pngDir = join(root, 'kneeboard', aircraftFolderName(config.aircraft));

function runBuild() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build:kneeboard'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function sortedFiles(directory, extension) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort((a, b) => a.localeCompare(b));
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function expectedPages() {
  const pages = [
    ...(rawConfig.summaryPages || []),
    ...config.pages,
  ].sort((a, b) => a.file.localeCompare(b.file));

  return pages.flatMap((page) => {
    if (!page.deviceId) return [{ ...page, outputFile: page.file }];
    return renderSharedHardwarePages({
      ...page,
      commonRoot,
      provenance: { consumer: `DCS-${aircraftFolderName(config.aircraft)}-Components`, page: '{{PAGE}}' },
    }).map((rendered) => ({ ...page, outputFile: rendered.file }));
  });
}

test('kneeboard output satisfies the consumer contract and rebuilds deterministically', async () => {
  runBuild();

  assert.ok(existsSync(sourceDir), 'missing kneeboard/source');
  assert.ok(existsSync(pngDir), `missing ${pngDir}`);

  const pages = expectedPages();
  const expectedSvg = pages.map(({ outputFile }) => `${outputFile}.svg`).sort((a, b) => a.localeCompare(b));
  const expectedPng = pages.map(({ outputFile }) => `${outputFile}.png`).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(sortedFiles(sourceDir, '.svg'), expectedSvg, 'unexpected SVG page set');
  assert.deepEqual(sortedFiles(pngDir, '.png'), expectedPng, 'unexpected PNG page set');

  const firstHashes = new Map();
  for (const [index, page] of pages.entries()) {
    const svgFile = join(sourceDir, `${page.outputFile}.svg`);
    const pngFile = join(pngDir, `${page.outputFile}.png`);
    const svg = readFileSync(svgFile, 'utf8');

    assert.match(svg, /<svg\b[^>]*\bwidth="1200"[^>]*\bheight="1600"/i, `${basename(svgFile)} has invalid dimensions`);
    assert.doesNotMatch(svg, /\b(?:href|src)\s*=\s*["'](?:https?:|file:|\\\\)/i, `${basename(svgFile)} uses an external resource`);
    assert.doesNotMatch(svg, /\{\{[^}]+\}\}/, `${basename(svgFile)} contains an unresolved token`);
    assert.ok(svg.includes(`${index + 1} / ${pages.length}`), `${basename(svgFile)} has the wrong page footer`);
    if (page.title) assert.ok(svg.includes(escapeXml(page.title)), `${basename(svgFile)} is missing its title`);
    if (page.kicker) assert.ok(svg.includes(escapeXml(page.kicker)), `${basename(svgFile)} is missing its kicker`);
    if (page.deviceId) {
      assert.ok(svg.includes(`Shared DCS-Common device: ${page.deviceId}`), `${basename(svgFile)} is missing its shared-device marker`);
    }

    const metadata = await sharp(pngFile).metadata();
    assert.equal(metadata.width, 1200, `${basename(pngFile)} has invalid width`);
    assert.equal(metadata.height, 1600, `${basename(pngFile)} has invalid height`);
    firstHashes.set(svgFile, digest(svgFile));
    firstHashes.set(pngFile, digest(pngFile));
  }

  runBuild();
  for (const [file, hash] of firstHashes) {
    assert.equal(digest(file), hash, `${basename(file)} changed during an identical rebuild`);
  }
});
