import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Template file ─────────────────────────────────────────────────────────────
const templatePath = join(root, 'kneeboard', 'source', 'drawio', 'hardware-page-template.drawio');
assert.ok(existsSync(templatePath), 'hardware-page-template.drawio should exist');

const template = readFileSync(templatePath, 'utf8');
assert.match(template, /<mxfile/,         'template should be a draw.io mxfile');
assert.match(template, /<mxGraphModel/,   'template should contain a graph model');
assert.match(template, /pageWidth="1200"/, 'template page should be 1200 px wide');
assert.match(template, /pageHeight="1600"/, 'template page should be 1600 px tall');

// Every callout pair must have a label, anchor dot, and connector
assert.match(template, /id="lbl-1"/, 'template should contain at least one label cell');
assert.match(template, /id="anchor-1"/, 'template should contain at least one anchor cell');
assert.match(template, /id="conn-1"/, 'template should contain at least one connector cell');

// ── Processing script ─────────────────────────────────────────────────────────
const scriptPath = join(root, 'scripts', 'process-drawio-export.mjs');
assert.ok(existsSync(scriptPath), 'process-drawio-export.mjs should exist');

const script = readFileSync(scriptPath, 'utf8');
assert.match(script, /--input/,  'script should accept --input flag');
assert.match(script, /--output/, 'script should accept --output flag');
assert.match(script, /--width/,  'script should accept --width flag');
assert.match(script, /--height/, 'script should accept --height flag');
assert.match(script, /sharp/,    'script should use sharp for PNG conversion');

console.log('Draw.io workflow validation passed.');
