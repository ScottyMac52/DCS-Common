import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  sharp = null;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');

const ACCENTS = Object.freeze({
  cyan: { fill: '#15314e', stroke: '#46d8ff' },
  gold: { fill: '#3e2d12', stroke: '#ffc95c' },
  red: { fill: '#38131c', stroke: '#ff6b76' },
  blue: { fill: '#142b52', stroke: '#579dff' },
  orange: { fill: '#412511', stroke: '#ff9d45' },
  purple: { fill: '#301b46', stroke: '#bd7cff' },
  green: { fill: '#153526', stroke: '#5fda91' },
});

function accentColors(name) {
  return ACCENTS[name] || ACCENTS.cyan;
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrap(text, max = 28, limit = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= limit) return lines;
  const clipped = lines.slice(0, limit);
  clipped[limit - 1] = `${clipped[limit - 1].replace(/[.,;:]$/, '')}…`;
  return clipped;
}

function frame(title, kicker, body, index, pageCount) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#07111d"/>
  <rect x="48" y="48" width="1104" height="1504" rx="28" fill="#0a1629" stroke="#2c4566" stroke-width="3"/>
  <rect x="48" y="48" width="1104" height="120" rx="28" fill="#12253d"/>
  <text x="96" y="118" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="800" fill="#f4f8fb">${esc(title)}</text>
  <text x="96" y="154" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="1.3" fill="#63d7ff">${esc(kicker)}</text>
  ${body}
  <text x="96" y="1520" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#88a3ba">DCS-Common shared kneeboard renderer</text>
  <text x="1104" y="1520" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#88a3ba">${index + 1} / ${pageCount}</text>
</svg>`;
}

function renderDiffTemplate(template, profile) {
  const bindings = profile.bindings || [];
  const rendered = [];
  for (const binding of bindings) {
    rendered.push(template.replaceAll('{{repo}}', profile.repo).replaceAll('{{binding}}', binding.name).replaceAll('{{label}}', binding.label));
  }
  return rendered.join('\n');
}

function summaryPage(page, index, pageCount) {
  const cards = page.items.map((entry, itemIndex) => {
    const x = 96 + (itemIndex % 2) * 480;
    const y = 220 + Math.floor(itemIndex / 2) * 170;
    const { fill, stroke } = accentColors(entry.accent);
    const lines = wrap(entry.text, 28, 2);
    return `<g>
      <rect x="${x}" y="${y}" width="420" height="130" rx="16" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <rect x="${x + 16}" y="${y + 14}" width="86" height="102" rx="12" fill="#07111d" stroke="${stroke}" stroke-width="2"/>
      <text x="${x + 59}" y="${y + 65}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="800" fill="${stroke}">${esc(entry.key)}</text>
      <text x="${x + 122}" y="${y + 42}" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#f5f9ff">${esc(lines[0] || '')}</text>
      ${lines[1] ? `<text x="${x + 122}" y="${y + 70}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="500" fill="#dbe7f4">${esc(lines[1])}</text>` : ''}
      ${lines[2] ? `<text x="${x + 122}" y="${y + 96}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="500" fill="#dbe7f4">${esc(lines[2])}</text>` : ''}
    </g>`;
  }).join('');
  return frame(page.title, page.kicker, cards, index, pageCount);
}

function imageElement(layer) {
  const opacity = layer.opacity ?? 1;
  return `<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" href="${layer.href}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}"/>`;
}

function hardwarePage(page, index, pageCount) {
  const body = [
    '<g>',
    '<rect x="160" y="220" width="880" height="1150" rx="24" fill="#08121f" stroke="#37506b" stroke-width="2"/>',
  ];
  for (const layer of page.images || []) body.push(imageElement(layer));
  const callouts = page.callouts || [];
  const left = callouts.filter((entry) => entry.side === 'left');
  const right = callouts.filter((entry) => entry.side === 'right');
  const drawPositionedCallout = (entry, side, fallbackX, fallbackY) => {
    const x = entry.x ?? fallbackX;
    const y = entry.y ?? fallbackY;
    const width = entry.width ?? 260;
    const height = entry.height ?? 44;
    const accent = accentColors(entry.accent).stroke;
    const anchors = entry.anchors || (entry.anchor ? [entry.anchor] : []);
    const controls = entry.controls || (entry.control ? [entry.control] : []);
    const lineX = side === 'left' ? x + width : x;
    const lineY = y + height / 2;

    anchors.forEach(([anchorX, anchorY], anchorIndex) => {
      body.push(`<path d="M ${lineX} ${lineY} L ${anchorX} ${anchorY}" fill="none" stroke="${accent}" stroke-width="2.5" opacity="0.9"/>`);
      const control = controls[anchorIndex] || controls[0];
      body.push(`<circle${control ? ` data-control="${esc(control)}"` : ''} cx="${anchorX}" cy="${anchorY}" r="5" fill="none" stroke="${accent}" stroke-width="2.5"/>`);
    });

    body.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${entry.radius ?? 10}" fill="#12253d" stroke="${accent}" stroke-width="2"/>`);
    const labelWidth = entry.labelWidth ?? 92;
    body.push(`<rect x="${x + 9}" y="${y + 9}" width="${labelWidth}" height="${height - 18}" rx="8" fill="#07111d" stroke="${accent}" stroke-width="1.5"/>`);
    body.push(`<text x="${x + 9 + labelWidth / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${entry.labelFontSize ?? 14}" font-weight="800" fill="${accent}">${esc(entry.label || entry.key)}</text>`);
    const lines = entry.lines || wrap(entry.text, 18, 2);
    const firstLineY = y + (height - (lines.length - 1) * 18) / 2 + 5;
    lines.forEach((line, lineIndex) => {
      body.push(`<text x="${x + labelWidth + 20}" y="${firstLineY + lineIndex * 18}" font-family="Segoe UI, Arial, sans-serif" font-size="${entry.fontSize ?? 15}" font-weight="600" fill="#f5f9ff">${esc(line)}</text>`);
    });
    if (entry.title) body.push(`<title>${esc(entry.title)}</title>`);
  };
  const drawSide = (entries, side, x) => {
    entries.forEach((entry, idx) => {
      const y = 250 + idx * 70;
      if (entry.anchor || entry.anchors || entry.x !== undefined || entry.y !== undefined) {
        drawPositionedCallout(entry, side, x, y);
        return;
      }
      const accent = accentColors(entry.accent).stroke;
      body.push(`<rect x="${x}" y="${y}" width="260" height="44" rx="10" fill="#12253d" stroke="${accent}" stroke-width="2"/>`);
      body.push(`<text x="${x + 18}" y="${y + 28}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800" fill="${accent}">${esc(entry.key)}</text>`);
      body.push(`<text x="${x + 130}" y="${y + 28}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="600" fill="#f5f9ff">${esc(entry.text)}</text>`);
    });
  };
  drawSide(left, 'left', 120);
  drawSide(right, 'right', 820);
  if (page.notes?.length) {
    page.notes.forEach((note, indexNote) => {
      const y = 1320 + indexNote * 74;
      const accent = accentColors(note.accent).stroke;
      body.push(`<rect x="120" y="${y}" width="960" height="56" rx="12" fill="#11253c" stroke="${accent}" stroke-width="2"/>`);
      body.push(`<text x="150" y="${y + 23}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800" fill="${accent}">${esc(note.key)}</text>`);
      body.push(`<text x="280" y="${y + 24}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" fill="#f5f9ff">${esc(note.text)}</text>`);
    });
  }
  body.push('</g>');
  return frame(page.title, page.kicker, body.join(''), index, pageCount);
}

function inferMime(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function loadAssets(assets, baseDir) {
  const loaded = {};
  for (const [name, definition] of Object.entries(assets || {})) {
    if (typeof definition === 'string') {
      loaded[name] = definition;
      continue;
    }
    const filePath = resolve(baseDir, definition.path);
    const buffer = readFileSync(filePath);
    const mime = definition.mime || inferMime(filePath);
    loaded[name] = `data:${mime};base64,${buffer.toString('base64')}`;
  }
  return loaded;
}

function loadSharedComponentManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest.components || [];
}

function resolveHref(href, assets) {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    if (typeof href.asset === 'string') return assets[href.asset] || '';
    if (typeof href.href === 'string') return href.href;
    if (href.href && typeof href.href === 'object' && typeof href.href.asset === 'string') return assets[href.href.asset] || '';
  }
  return '';
}

function normalizePage(page, assets, sharedAssetConfig) {
  const normalized = { ...page };
  if (normalized.images) {
    normalized.images = normalized.images.map((layer) => {
      const resolvedHref = resolveHref(layer.href, assets);
      return { ...layer, href: resolvedHref };
    });
  }
  if (sharedAssetConfig?.componentId && normalized.type === 'hardware' && !normalized.images?.some((layer) => typeof layer.href === 'string' && layer.href.includes('data:'))) {
    normalized.images = [
      ...(normalized.images || []),
      {
        href: resolveHref({ asset: sharedAssetConfig.componentId }, assets),
        x: sharedAssetConfig.x ?? 274,
        y: sharedAssetConfig.y ?? 250,
        width: sharedAssetConfig.width ?? 652,
        height: sharedAssetConfig.height ?? 725,
        opacity: sharedAssetConfig.opacity ?? 0.95,
      },
    ];
  }
  return normalized;
}

export async function renderKneeboard({ config, outputDir = join(rootDir, 'dist', 'kneeboard'), rootDir: customRootDir = rootDir }) {
  const resolvedRootDir = resolve(customRootDir);
  const resolvedOutputDir = resolve(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });
  const sharedManifestPath = join(resolvedRootDir, 'assets', 'shared', 'components', 'component-manifest.json');
  const sharedComponents = existsSync(sharedManifestPath) ? loadSharedComponentManifest(sharedManifestPath) : [];

  const assets = await loadAssets(config.assets || {}, resolvedRootDir);
  for (const component of sharedComponents) {
    const assetPath = resolve(resolvedRootDir, component.asset);
    const buffer = readFileSync(assetPath);
    const mime = inferMime(assetPath);
    assets[component.id] = `data:${mime};base64,${buffer.toString('base64')}`;
  }
  const pages = (config.pages || []).map((page) => normalizePage(page, assets, config.sharedAssets));
  const created = [];
  for (const [index, page] of pages.entries()) {
    const svg = page.type === 'summary' ? summaryPage(page, index, pages.length) : hardwarePage(page, index, pages.length);
    const svgPath = join(resolvedOutputDir, `${page.file}.svg`);
    writeFileSync(svgPath, svg, 'utf8');
    created.push(svgPath);
    if (sharp) {
      const pngPath = join(resolvedOutputDir, `${page.file}.png`);
      await sharp(Buffer.from(svg)).png().toFile(pngPath);
      created.push(pngPath);
    }
  }

  const profiles = config.profiles || [];
  for (const profile of profiles) {
    const template = config.diffTemplate || 'local diff = { repo = "{{repo}}", binding = "{{binding}}", label = "{{label}}" }';
    const diffPath = join(resolvedOutputDir, `${profile.file}.diff.lua`);
    const diffContent = renderDiffTemplate(template, profile);
    writeFileSync(diffPath, diffContent, 'utf8');
    created.push(diffPath);
  }

  return {
    outputDir: resolvedOutputDir,
    svgFiles: created.filter((path) => path.endsWith('.svg')),
    pngFiles: created.filter((path) => path.endsWith('.png')),
    diffFiles: created.filter((path) => path.endsWith('.diff.lua')),
  };
}

export async function renderExample() {
  const { config } = await import(join(rootDir, 'examples', 'f14b-config.mjs'));
  return renderKneeboard({ config, outputDir: join(rootDir, 'dist', 'example-kneeboard'), rootDir });
}
