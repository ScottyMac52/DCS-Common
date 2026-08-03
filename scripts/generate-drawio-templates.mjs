/**
 * Generates draw.io template files from the shared hardware SVGs.
 *
 * For each hardware device the script produces a .drawio file that has:
 *   - the hardware SVG (base64-embedded) as the locked background image
 *   - an editable text label cell placed exactly over every callout slot
 *
 * The contributor workflow is then:
 *   1. npm run build:drawio-templates
 *   2. Open kneeboard/source/drawio/hardware/<device>.drawio in draw.io
 *   3. Click each "Binding Name" label and type the actual DCS binding
 *   4. File > Export as > SVG  (save to kneeboard/source/exported/)
 *   5. npm run build:drawio  → converts exported SVGs to PNG kneeboard pages
 *
 * Usage:
 *   node scripts/generate-drawio-templates.mjs
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir  = join(root, 'assets/shared/hardware/svg');
const outDir  = join(root, 'kneeboard/source/drawio/hardware');

mkdirSync(outDir, { recursive: true });

// ── SVG parsing helpers ───────────────────────────────────────────────────────

/** Extract viewBox/width/height from the root <svg> element. */
function svgDimensions(content) {
  const m = content.match(/<svg[^>]+width="(\d+)"[^>]+height="(\d+)"/);
  if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  // fallback: parse viewBox
  const vb = content.match(/viewBox="[^"]*\s(\d+)\s(\d+)"/);
  if (vb) return { w: parseInt(vb[1], 10), h: parseInt(vb[2], 10) };
  return { w: 960, h: 600 };
}

/**
 * Extract all callout label positions from the SVG.
 * Each <text id="lbl-…" x="…" y="…"> maps to a draw.io label cell.
 * The label box is 160 × 22 px centred on (x, y-4).
 */
function svgLabels(content) {
  const labels = [];
  const re = /<text\s+id="(lbl-[^"]+)"\s+x="(\d+)"\s+y="(\d+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const id = m[1];
    const tx = parseInt(m[2], 10);   // centre x of the label box
    const ty = parseInt(m[3], 10);   // text baseline (≈ box y + 15)
    labels.push({
      id,
      bx: tx - 80,   // box left  (LW = 160)
      by: ty - 15,   // box top   (LH = 22, baseline offset = 15)
      bw: 160,
      bh: 22,
    });
  }
  return labels;
}

// ── draw.io XML builders ──────────────────────────────────────────────────────

function bgCell(svgDataUri, w, h) {
  return `        <mxCell id="bg" value="" style="shape=image;whiteSpace=wrap;html=1;aspect=fixed;locked=1;image=${svgDataUri};" vertex="1" parent="1">
          <mxGeometry x="0" y="0" width="${w}" height="${h}" as="geometry" />
        </mxCell>`;
}

function labelCell(label, index) {
  const { id, bx, by, bw, bh } = label;
  // Clamp so the box never starts off-canvas on the left
  const x = Math.max(2, bx);
  return `        <mxCell id="${id}" value="Binding Name" style="text;html=1;align=center;verticalAlign=middle;rounded=1;arcSize=30;fillColor=#1e293b;strokeColor=#00bfff;fontColor=#f1f5f9;fontFamily=Arial;fontSize=11;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${by}" width="${bw}" height="${bh}" as="geometry" />
        </mxCell>`;
}

function drawioFile(deviceId, label, w, h, cells) {
  return `<mxfile host="app.diagrams.net" type="device">
  <diagram id="${deviceId}" name="${label}">
    <mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const manifest = JSON.parse(
  readFileSync(join(root, 'assets/shared/hardware/manifest.json'), 'utf8'),
);

let written = 0;
for (const device of manifest.devices) {
  const svgPath = join(root, 'assets/shared/hardware', device.svg);
  if (!existsSync(svgPath)) {
    console.warn(`  skip ${device.id} — SVG not found`);
    continue;
  }

  const svgContent = readFileSync(svgPath, 'utf8');
  const { w, h }   = svgDimensions(svgContent);
  const labels     = svgLabels(svgContent);

  if (labels.length === 0) {
    console.log(`  skip ${device.id} — no callout labels (no-image placeholder)`);
    continue;
  }

  // Embed the whole SVG as the locked background
  const b64      = Buffer.from(svgContent).toString('base64');
  const dataUri  = `data:image/svg+xml;base64,${b64}`;

  const cells = [
    bgCell(dataUri, w, h),
    ...labels.map(labelCell),
  ];

  const xml      = drawioFile(device.id, device.label, w, h, cells);
  const outPath  = join(outDir, `${device.id}.drawio`);
  writeFileSync(outPath, xml, 'utf8');
  console.log(`  wrote ${device.id}.drawio  (${labels.length} labels, ${w}×${h})`);
  written++;
}

console.log(`\nGenerated ${written} draw.io template(s) in ${outDir}`);
