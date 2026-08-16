import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { decodeDrawioGraph } from '../scripts/drawio-source.mjs';

const graph = '<mxGraphModel pageWidth="100" pageHeight="50"><root /></mxGraphModel>';

test('decodes compressed and uncompressed draw.io diagrams', () => {
  const uncompressed = `<mxfile><diagram>${graph}</diagram></mxfile>`;
  const compressedPayload = deflateRawSync(encodeURIComponent(graph)).toString('base64');
  const compressed = `<mxfile><diagram>${compressedPayload}</diagram></mxfile>`;

  assert.equal(decodeDrawioGraph(uncompressed, 'uncompressed'), graph);
  assert.equal(decodeDrawioGraph(compressed, 'compressed'), graph);
});

test('rejects missing and malformed draw.io diagrams with source context', () => {
  assert.throws(
    () => decodeDrawioGraph('<mxfile />', 'missing.drawio'),
    /missing\.drawio: draw\.io source must contain a diagram/,
  );
  assert.throws(
    () => decodeDrawioGraph('<mxfile><diagram>not-compressed</diagram></mxfile>', 'broken.drawio'),
    /broken\.drawio: invalid compressed draw\.io diagram/,
  );
});
