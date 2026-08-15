import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const affectedAssets = [
  'drawio/viper-tqs-mission-pack.drawio',
  'drawio/vkb-f14-gunfighter.drawio',
  'svg/viper-tqs-mission-pack.svg',
  'svg/vkb-f14-gunfighter.svg',
];

test('affected shared-hardware assets retain complete embedded images', () => {
  for (const relativePath of affectedAssets) {
    const contents = readFileSync(join(root, 'assets', 'shared', 'hardware', relativePath), 'utf8');
    const images = [...contents.matchAll(/data:image\/(png|jpeg)(?:;base64)?,([A-Za-z0-9+/=]+)/g)];
    assert.equal(images.length, 2, `${relativePath} must retain both embedded hardware images`);

    for (const [, format, encoded] of images) {
      assert.equal(encoded.length % 4, 0, `${relativePath} contains truncated base64 image data`);
      const decoded = Buffer.from(encoded, 'base64');
      assert.equal(decoded.toString('base64'), encoded,
        `${relativePath} contains invalid or noncanonical base64 image data`);

      if (format === 'png') {
        assert.equal(decoded.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
          `${relativePath} embedded image must start with a PNG signature`);
        assert.equal(decoded.subarray(-12).toString('hex'), '0000000049454e44ae426082',
          `${relativePath} embedded PNG must end with a complete IEND chunk`);
      } else {
        assert.equal(decoded.subarray(0, 2).toString('hex'), 'ffd8',
          `${relativePath} embedded image must start with a JPEG signature`);
        assert.equal(decoded.subarray(-2).toString('hex'), 'ffd9',
          `${relativePath} embedded JPEG must end with an EOI marker`);
      }
    }
  }
});
