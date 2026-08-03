/**
 * Converts draw.io-exported SVG files into PNG kneeboard pages.
 *
 * Workflow:
 *   1. Contributor opens a .drawio template from kneeboard/source/drawio/
 *   2. They embed the shared hardware SVG as the background image
 *   3. They edit binding labels and drag anchor dots to the correct controls
 *   4. They export each page as SVG (File > Export as > SVG, uncheck "Fit Page")
 *   5. They save the exported SVGs into the --input directory
 *   6. This script converts each SVG to a PNG kneeboard page
 *
 * Usage:
 *   node scripts/process-drawio-export.mjs \
 *       --input  kneeboard/source/exported \
 *       --output kneeboard/pages \
 *       --width  1200 \
 *       --height 1600
 *
 * All arguments are optional; the defaults above are used when omitted.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Argument parsing ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const inputDir  = resolve(root, flag('--input',  'kneeboard/source/exported'));
const outputDir = resolve(root, flag('--output', 'kneeboard/pages'));
const W = parseInt(flag('--width',  '1200'), 10);
const H = parseInt(flag('--height', '1600'), 10);

// ── Dependency check ──────────────────────────────────────────────────────────
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is required: npm install sharp');
  process.exit(1);
}

// ── Input validation ──────────────────────────────────────────────────────────
if (!existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  console.error('Export SVG pages from draw.io and place them in that directory.');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const svgFiles = readdirSync(inputDir)
  .filter(f => extname(f).toLowerCase() === '.svg')
  .sort();

if (svgFiles.length === 0) {
  console.warn(`No SVG files found in ${inputDir}`);
  console.warn('Export each draw.io page as SVG and place the files there.');
  process.exit(0);
}

// ── Conversion ────────────────────────────────────────────────────────────────
console.log(`Converting ${svgFiles.length} SVG page(s) → ${W}×${H} PNG...`);

let written = 0;
for (const file of svgFiles) {
  const svgPath = join(inputDir, file);
  const pngName = basename(file, extname(file)) + '.png';
  const pngPath = join(outputDir, pngName);

  try {
    const svgBuf = readFileSync(svgPath);

    if (!svgBuf.toString('utf8', 0, 512).includes('<svg')) {
      console.warn(`  skip ${file} — does not appear to be SVG`);
      continue;
    }

    await sharp(svgBuf, { density: 150 })
      .resize(W, H, {
        fit: 'contain',
        background: { r: 7, g: 17, b: 29, alpha: 1 },
      })
      .png()
      .toFile(pngPath);

    console.log(`  wrote ${pngName}`);
    written++;
  } catch (err) {
    console.error(`  error processing ${file}: ${err.message}`);
  }
}

console.log(`\nDone — ${written} of ${svgFiles.length} page(s) converted.`);
