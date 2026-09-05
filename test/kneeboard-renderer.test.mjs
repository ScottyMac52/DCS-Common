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
  assert.ok(existsSync(join(outputDir, 'sample-profile.diff.lua')));

  const overview = readFileSync(join(outputDir, '01-SHARED-OVERVIEW.svg'), 'utf8');
  assert.match(overview, /SHARED KNEEBOARD RENDERER/);
  assert.match(overview, /Consumer repos supply page/);
  assert.match(overview, /definitions/);

  const hardware = readFileSync(join(outputDir, '02-SAMPLE-HARDWARE.svg'), 'utf8');
  assert.match(hardware, /SAMPLE HARDWARE PAGE/);
  assert.match(hardware, /Primary action/);

  const sharedImagePayload = hardware.match(/href="(data:image\/svg\+xml;base64,[^"]+)"/);
  assert.ok(sharedImagePayload, 'expected shared component image payload in rendered SVG');
  const encoded = sharedImagePayload[1].split(',')[1];
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  assert.match(decoded, /GENERIC CONTROL PANEL/);

  const diff = readFileSync(join(outputDir, 'sample-profile.diff.lua'), 'utf8');
  assert.match(diff, /sample-repo/);
  assert.match(diff, /primary-action/);
  assert.match(diff, /secondary-action/);

  assert.ok(result.pngFiles.length === 0 || existsSync(join(outputDir, '01-SHARED-OVERVIEW.png')));
});

test('renders positioned callouts with exact control anchors', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'dcs-common-positioned-'));
  const positionedConfig = {
    pages: [{
      type: 'hardware',
      file: '01-POSITIONED',
      title: 'POSITIONED CONTROLS',
      kicker: 'ANCHOR-AWARE CALLOUTS',
      callouts: [{
        key: 'BTN 25 / 26',
        label: 'BTN 25 / 26',
        text: 'Time accelerate / Time decelerate',
        lines: ['Time Accel / Decel', '↑ BTN25  ↓ BTN26'],
        side: 'left',
        accent: 'gold',
        x: 40,
        y: 540,
        width: 286,
        height: 96,
        anchors: [[455, 840], [455, 858]],
        controls: ['JOY_BTN25', 'JOY_BTN26'],
      }],
    }],
  };

  await renderKneeboard({ positionedConfig, config: positionedConfig, outputDir, rootDir: resolve(__dirname, '..') });
  const svg = readFileSync(join(outputDir, '01-POSITIONED.svg'), 'utf8');
  assert.match(svg, /data-control="JOY_BTN25"/);
  assert.match(svg, /data-control="JOY_BTN26"/);
  assert.match(svg, /M 326 588 L 455 840/);
  assert.match(svg, /BTN 25 \/ 26/);
  assert.match(svg, /Time Accel \/ Decel/);
});


test('renders the extended summary accent palette', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'dcs-common-accents-'));
  const accentConfig = {
    pages: [{
      type: 'summary',
      file: '01-ACCENTS',
      title: 'MANUFACTURER ACCENTS',
      kicker: 'COLOR PALETTE',
      items: [
        { key: 'TM', text: 'Thrustmaster', accent: 'blue' },
        { key: 'WIN', text: 'WINCTRL', accent: 'cyan' },
        { key: 'VKB', text: 'VKB', accent: 'orange' },
        { key: 'OYT', text: 'OnYourTwelve', accent: 'purple' },
        { key: 'MOZA', text: 'MOZA', accent: 'red' },
        { key: 'OTHER', text: 'Other', accent: 'green' },
      ],
    }],
  };

  await renderKneeboard({ config: accentConfig, outputDir, rootDir: resolve(__dirname, '..') });
  const svg = readFileSync(join(outputDir, '01-ACCENTS.svg'), 'utf8');
  for (const color of ['#579dff', '#46d8ff', '#ff9d45', '#bd7cff', '#ff6b76', '#5fda91']) {
    assert.match(svg, new RegExp(color));
  }
});
