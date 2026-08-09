import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hardwareRoot = join(root, 'assets/shared/hardware');
const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

// Optional config for export behaviour (defaults keep published SVGs clean).
const exportConfigPath = join(hardwareRoot, 'export-config.json');
const exportConfig = existsSync(exportConfigPath)
  ? JSON.parse(readFileSync(exportConfigPath, 'utf8'))
  : {};
const includeButtonNumberWatermarks = exportConfig.includeButtonNumberWatermarks === true
  || process.argv.includes('--watermarks');

const decode = (value = '') => value
  .replaceAll('&quot;', '"')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&');
const esc = (value = '') => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const attr = (source, name) => decode(source.match(new RegExp(`${name}=\"([^\"]*)\"`))?.[1]);
const styleValue = (style, name) => {
  if (name === 'image') {
    const image = style.match(/(?:^|;)image=(data:image\/[^,;]+,[A-Za-z0-9+/=]+)(?:;|$)/)?.[1];
    return image?.replace(',', ';base64,');
  }
  return style.split(';').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
};

function cells(xml) {
  return [...xml.matchAll(/<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g)].map((match) => {
    const tag = match[1];
    const body = match[2] ?? '';
    const geometryTag = body.match(/<mxGeometry\b([^>]*)\/>/)?.[1] ?? '';
    return {
      id: attr(tag, 'id'), value: attr(tag, 'value'), style: attr(tag, 'style'),
      source: attr(tag, 'source'), target: attr(tag, 'target'),
      vertex: attr(tag, 'vertex') === '1', edge: attr(tag, 'edge') === '1',
      x: Number(attr(geometryTag, 'x') || 0), y: Number(attr(geometryTag, 'y') || 0),
      width: Number(attr(geometryTag, 'width') || 0), height: Number(attr(geometryTag, 'height') || 0),
    };
  });
}

function endpoint(label, anchor) {
  const ax = anchor.x + anchor.width / 2;
  const ay = anchor.y + anchor.height / 2;
  const cx = label.x + label.width / 2;
  const cy = label.y + label.height / 2;
  const dx = ax - cx;
  const dy = ay - cy;
  if (Math.abs(dx / label.width) > Math.abs(dy / label.height)) {
    return { x: dx > 0 ? label.x + label.width : label.x, y: cy };
  }
  return { x: cx, y: dy > 0 ? label.y + label.height : label.y };
}

function renderLabelBox(lines, label, id) {
  const style = label.style || '';
  const fillColor = styleValue(style, 'fillColor') || '#1e293b';
  const fontColor = styleValue(style, 'fontColor') || '#f1f5f9';
  const strokeColor = styleValue(style, 'strokeColor') || '#00bfff';
  const fontSize = styleValue(style, 'fontSize') || '11';
  const isTransparent = !fillColor || fillColor === 'none' || fillColor === 'transparent';

  if (!isTransparent) {
    lines.push(`  <rect x=\"${label.x}\" y=\"${label.y}\" width=\"${label.width}\" height=\"${label.height}\" rx=\"4\" fill=\"${esc(fillColor)}\" stroke=\"${esc(strokeColor)}\" stroke-width=\"1.5\"/>`);
  }

  // Vertical centering approximation for pure-text overlays and chips
  const textY = label.y + Math.round(Number(label.height) / 2) + 4;
  lines.push(`  <text id=\"lbl-${esc(id)}\" x=\"${label.x + label.width / 2}\" y=\"${textY}\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"${esc(fontSize)}\" fill=\"${esc(fontColor)}\">${esc(label.value)}</text>`);

  // Optional button-number watermark (controlled by export-config.json or --watermarks).
  // Data lives in the draw.io label style as buttonNumber=N.
  if (includeButtonNumberWatermarks) {
    const buttonNumber = styleValue(label.style || '', 'buttonNumber');
    if (buttonNumber) {
      const wx = label.x + label.width - 4;
      const wy = label.y + label.height - 3;
      lines.push(`  <text class=\"btn-watermark\" data-button=\"${esc(buttonNumber)}\" x=\"${wx}\" y=\"${wy}\" text-anchor=\"end\" font-family=\"Arial,sans-serif\" font-size=\"8\" fill=\"#94a3b8\" opacity=\"0.35\">${esc(buttonNumber)}</text>`);
    }
  }
}

function render(device, xml) {
  if (!xml.includes('compressed=\"false\"')) throw new Error(`${device.id}: draw.io source must be uncompressed XML`);
  const modelTag = xml.match(/<mxGraphModel\b([^>]*)>/)?.[1];
  const width = Number(attr(modelTag, 'pageWidth'));
  const height = Number(attr(modelTag, 'pageHeight'));
  const all = cells(xml);
  const byId = new Map(all.map((cell) => [cell.id, cell]));
  const canvas = byId.get('canvas');
  const images = all.filter((cell) => cell.id.startsWith('hardware-image-'));
  const connectors = all.filter((cell) => cell.id.startsWith('connector-'));
  const labels = all.filter((cell) => cell.id.startsWith('label-'));
  const footer = byId.get('footer');
  // Callout style: connectors + anchors. Box-only style: label-* without connectors
  // (embedded artwork already shows controls; overlay boxes are the binding names).
  if (!canvas || !images.length || !footer) {
    throw new Error(`${device.id}: incomplete native draw.io graph (need canvas, hardware-image-*, footer)`);
  }
  if (!connectors.length && !labels.length) {
    throw new Error(`${device.id}: incomplete native draw.io graph (need connector-* and/or label-*)`);
  }

  const lines = [
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\">`,
    `  <rect width=\"${width}\" height=\"${height}\" fill=\"${styleValue(canvas.style, 'fillColor')}\"/>`,
  ];
  for (const image of images) {
    lines.push(`  <image href=\"${esc(styleValue(image.style, 'image'))}\" x=\"${image.x}\" y=\"${image.y}\" width=\"${image.width}\" height=\"${image.height}\" preserveAspectRatio=\"xMidYMid meet\"/>`);
  }

  const labelsViaConnector = new Set();
  for (const connector of connectors) {
    const label = byId.get(connector.source);
    const anchor = byId.get(connector.target);
    if (!label || !anchor) throw new Error(`${device.id}: ${connector.id} has a missing source or target`);
    const id = connector.id.slice('connector-'.length);
    labelsViaConnector.add(label.id);
    const ax = anchor.x + anchor.width / 2;
    const ay = anchor.y + anchor.height / 2;
    const end = endpoint(label, anchor);
    lines.push(`  <!-- callout:${id} -->`);
    lines.push(`  <line x1=\"${ax}\" y1=\"${ay}\" x2=\"${end.x}\" y2=\"${end.y}\" stroke=\"#00bfff\" stroke-width=\"1.5\" stroke-dasharray=\"5 3\" opacity=\"0.75\"/>`);
    lines.push(`  <circle cx=\"${ax}\" cy=\"${ay}\" r=\"5\" fill=\"#00bfff\" stroke=\"#0f172a\" stroke-width=\"1.5\"/>`);
    renderLabelBox(lines, label, id);
  }

  // Standalone label boxes (no callout lines) — used when the photo already has control artwork.
  for (const label of labels) {
    if (labelsViaConnector.has(label.id)) continue;
    const id = label.id.startsWith('label-') ? label.id.slice('label-'.length) : label.id;
    lines.push(`  <!-- box:${id} -->`);
    renderLabelBox(lines, label, id);
  }

  lines.push(`  <text x=\"${width / 2}\" y=\"${height - 8}\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"12\" fill=\"#475569\">${esc(footer.value)}</text>`);
  lines.push('</svg>');
  return lines.join('\n');
}

let processed = 0;
const stale = [];
for (const device of manifest.devices.filter((entry) => entry.drawio && entry.deterministicExport !== false)) {
  const xml = readFileSync(join(hardwareRoot, device.drawio), 'utf8');
  const output = render(device, xml);
  const target = join(hardwareRoot, device.svg);
  if (checkOnly) {
    if (readFileSync(target, 'utf8') !== output) stale.push(device.svg);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, 'utf8');
    console.log(`exported ${device.drawio} -> ${device.svg}`);
  }
  processed += 1;
}
if (stale.length) {
  throw new Error(`Published draw.io SVG output is stale: ${stale.join(', ')}. Run npm run build:drawio-hardware.`);
}
console.log(checkOnly
  ? `Verified ${processed} published draw.io hardware template(s).`
  : `Exported ${processed} draw.io hardware template(s)${includeButtonNumberWatermarks ? ' (with button-number watermarks)' : ''}.`);
