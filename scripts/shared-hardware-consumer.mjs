import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// Build entities via concat so tooling cannot strip the amp; sequences.
const escapeXml = (value = '') =>
  String(value)
    .replaceAll('&', '&' + 'amp;')
    .replaceAll('<', '&' + 'lt;')
    .replaceAll('>', '&' + 'gt;')
    .replaceAll('"', '&' + 'quot;');

/** Locked modifier color vocabulary (issue #87). Index 0 = base (no modifier). */
export const MODIFIER_COLOR_CONTRACT = Object.freeze([
  { role: 'base', name: 'Base', fill: '#ffffff' },
  { role: 'modifier-1', name: 'Modifier 1', fill: '#dc2626' }, // red
  { role: 'modifier-2', name: 'Modifier 2', fill: '#ea580c' }, // orange
  { role: 'modifier-3', name: 'Modifier 3', fill: '#2563eb' }, // blue
  { role: 'modifier-4', name: 'Modifier 4', fill: '#16a34a' }, // green
  { role: 'modifier-5', name: 'Modifier 5', fill: '#0891b2' }, // cyan
]);

export function modifierColorAt(index = 0) {
  const safe = Number.isInteger(index) && index >= 0 ? index : 0;
  return MODIFIER_COLOR_CONTRACT[Math.min(safe, MODIFIER_COLOR_CONTRACT.length - 1)].fill;
}

/**
 * Build a legend block for the outer kneeboard page SVG.
 * @param {Array<{ label: string, fill: string }>} entries
 * @param {{ x?: number, y?: number }} [opts]
 */
export function renderModifierLegendSvg(entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const x = opts.x ?? 860;
  const y = opts.y ?? 1380;
  const rowH = 28;
  const boxW = 280;
  const boxH = 36 + entries.length * rowH;
  const rows = entries.map((entry, i) => {
    const cy = y + 32 + i * rowH;
    const fill = escapeXml(entry.fill ?? modifierColorAt(0));
    const label = escapeXml(entry.label ?? '');
    return `  <rect x="${x + 12}" y="${cy - 12}" width="14" height="14" rx="2" fill="${fill}"/>
  <text x="${x + 34}" y="${cy}" font-family="Arial,sans-serif" font-size="16" fill="#e2e8f0">${label}</text>`;
  }).join('\n');
  return `  <g data-modifier-legend="true">
  <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="#0b1726" stroke="#334155" stroke-width="1.5"/>
  <text x="${x + 12}" y="${y + 22}" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#94a3b8">SHIFT / MODIFIER</text>
${rows}
  </g>`;
}

const physicalPrefix = /^(?:JOY_)?BTN\s*\d[^:]*:/i;

function validateDisplayLabels(labels) {
  const values = Array.isArray(labels) ? labels : Object.values(labels);
  const text = (value) => Array.isArray(value)
    ? value.map((entry) => entry?.label ?? entry)
    : [value?.label ?? value];
  const invalid = values.flatMap(text).find((value) => physicalPrefix.test(String(value).trim()));
  if (invalid !== undefined) {
    throw new Error(`Shared hardware callout labels must describe functions without a physical-button prefix: ${invalid}`);
  }
}

export function resolveDcsCommonVersion(commonRoot = resolveDcsCommonRoot()) {
  if (process.env.DCS_COMMON_VERSION) return process.env.DCS_COMMON_VERSION;
  try {
    return execFileSync('git', ['-C', commonRoot, 'describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function formatProvenanceFooter({ commonRoot, consumer, consumerVersion, page = '' }) {
  if (!consumer) throw new Error('A consumer name is required for a provenance footer.');
  const commonVersion = resolveDcsCommonVersion(commonRoot);
  const version = consumerVersion ?? process.env.PACKAGE_VERSION ?? '0.0.0-local';
  return [`DCS-Common ${commonVersion}`, `${consumer} ${version}`, page].filter(Boolean).join(' • ');
}

export function resolveDcsCommonRoot(consumerRoot = process.cwd()) {
  const candidates = [process.env.DCS_COMMON_ROOT, join(consumerRoot, '.dcs-common')].filter(Boolean);
  const root = candidates.find((candidate) => existsSync(join(candidate, 'assets/shared/hardware/manifest.json')));
  if (!root) throw new Error('DCS-Common shared assets are unavailable. Set DCS_COMMON_ROOT or check out DCS-Common at .dcs-common.');
  return resolve(root);
}

export function loadSharedHardware(deviceId, { commonRoot = resolveDcsCommonRoot(), labels = {}, labelColors = {} } = {}) {
  validateDisplayLabels(labels);
  const hardwareRoot = join(commonRoot, 'assets/shared/hardware');
  const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
  const device = manifest.devices.find((entry) => entry.id === deviceId || entry.aliases?.includes(deviceId));
  if (!device) throw new Error(`Unknown shared hardware device: ${deviceId}`);
  let svg = readFileSync(join(hardwareRoot, device.svg), 'utf8');
  if (Array.isArray(device.imageMasks) && device.imageMasks.length > 0) {
    const masks = device.imageMasks.map((mask) =>
      `<rect id="${escapeXml(mask.id)}" x="${Number(mask.x)}" y="${Number(mask.y)}" width="${Number(mask.width)}" height="${Number(mask.height)}" fill="${escapeXml(mask.fill)}"/>`
    ).join('\n');
    const insertionPoint = svg.indexOf('<!-- box:');
    if (insertionPoint < 0) throw new Error(`Shared hardware device ${device.id} cannot place its image masks.`);
    svg = `${svg.slice(0, insertionPoint)}${masks}\n${svg.slice(insertionPoint)}`;
  }
  const calloutIds = [...svg.matchAll(/<text id="lbl-([^"]+)"/g)].map((match) => match[1]);
  const values = Array.isArray(labels)
    ? Object.fromEntries(calloutIds.map((id, index) => [id, labels[index] ?? '']))
    : labels;
  for (const id of calloutIds) {
    const configuredValue = values[id] ?? '';
    const variants = Array.isArray(configuredValue) ? configuredValue : null;
    const value = escapeXml(configuredValue);
    const color = labelColors[id];
    svg = svg.replace(new RegExp(`(<text id="lbl-${id}"[^>]*>)[\\s\\S]*?(</text>)`), (match, open, close) => {
      let tag = open;
      if (variants) {
        const x = tag.match(/\bx="([^"]+)"/)?.[1] ?? '0';
        const firstDy = -Math.max(0, variants.length - 1) * 5;
        const lines = variants.map((entry, index) => {
          const fill = entry?.color ? ` fill="${escapeXml(entry.color)}"` : '';
          const dy = index === 0 ? firstDy : 10;
          const fullLabel = entry?.fullLabel ? ` data-full-label="${escapeXml(entry.fullLabel)}"` : '';
          return `<tspan x="${escapeXml(x)}" dy="${dy}" font-size="9"${fill}${fullLabel}>${escapeXml(entry?.label ?? entry)}</tspan>`;
        }).join('');
        return `${tag}${lines}${close}`;
      }
      if (color) {
        const fill = escapeXml(color);
        if (/\bfill="[^"]*"/.test(tag)) tag = tag.replace(/\bfill="[^"]*"/, `fill="${fill}"`);
        else tag = tag.replace(/>$/, ` fill="${fill}">`);
      }
      return `${tag}${value}${close}`;
    });
  }
  return { device, svg, calloutIds };
}

export function renderSharedHardwarePage({ deviceId, labels = {}, labelColors = {}, legend = [], title, kicker = '', footer = '', provenance, commonRoot }) {
  const { device, svg, calloutIds } = loadSharedHardware(deviceId, { commonRoot, labels, labelColors });
  const encoded = Buffer.from(svg).toString('base64');
  const pageTitle = escapeXml(title ?? device.label);
  const pageFooter = provenance ? formatProvenanceFooter({ commonRoot, ...provenance }) : footer;
  const hasLegend = Array.isArray(legend) && legend.length > 0;
  const hardwareHeight = hasLegend ? 1170 : 1350;
  const legendSvg = renderModifierLegendSvg(legend, { x: 54, y: 1350 });
  return {
    calloutIds,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <desc>Shared DCS-Common device: ${escapeXml(deviceId)}</desc>
  <rect width="1200" height="1600" fill="#06101d"/>
  <rect width="1200" height="16" fill="#46d8ff"/>
  <text x="54" y="80" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#f5f9ff">${pageTitle}</text>
  <text x="56" y="126" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#ffc95c">${escapeXml(kicker)}</text>
  <image href="data:image/svg+xml;base64,${encoded}" x="35" y="155" width="1130" height="${hardwareHeight}" preserveAspectRatio="xMidYMid meet"/>
${legendSvg}
  <text x="54" y="1570" font-family="Arial,sans-serif" font-size="18" fill="#8ea5bd">${escapeXml(pageFooter)}</text>
</svg>`,
  };
}

const READABLE_BINDINGS_PER_PAGE = 12;

function displayLabel(value) {
  if (Array.isArray(value)) return value.map((entry) => entry?.label ?? entry).filter(Boolean).join(' / ');
  return value?.label ?? value ?? '';
}

function wrapBindingLabel(value, max = 38) {
  const words = String(value).trim().split(/\s+/u).filter(Boolean);
  const lines = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > max) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 2) return lines;
  return [lines[0], `${lines.slice(1).join(' ').slice(0, max - 1).trimEnd()}…`];
}

function renderReadableBindingsPage({ deviceId, title, kicker, entries, footer }) {
  const cards = entries.map((entry, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 54 + column * 566;
    const y = 180 + row * 216;
    const lines = wrapBindingLabel(entry.functionLabel);
    return `  <g data-readable-binding="${escapeXml(entry.id)}">
    <rect x="${x}" y="${y}" width="532" height="184" rx="18" fill="#0b1b2e" stroke="#2e5878" stroke-width="2"/>
    <text x="${x + 24}" y="${y + 45}" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#63d7ff">${escapeXml(entry.hardwareLabel)}</text>
    <text x="${x + 24}" y="${y + 98}" font-family="Arial,sans-serif" font-size="30" font-weight="800" fill="#f5f9ff">${escapeXml(lines[0] ?? '')}</text>
    ${lines[1] ? `<text x="${x + 24}" y="${y + 139}" font-family="Arial,sans-serif" font-size="30" font-weight="800" fill="#f5f9ff">${escapeXml(lines[1])}</text>` : ''}
  </g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <desc>Readable DCS-Common bindings: ${escapeXml(deviceId)}</desc>
  <rect width="1200" height="1600" fill="#06101d"/>
  <rect width="1200" height="16" fill="#46d8ff"/>
  <text x="54" y="80" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#f5f9ff">${escapeXml(title)}</text>
  <text x="56" y="126" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#ffc95c">${escapeXml(kicker)}</text>
${cards}
  <text x="54" y="1570" font-family="Arial,sans-serif" font-size="18" fill="#8ea5bd">${escapeXml(footer)}</text>
</svg>`;
}

/**
 * Render the visual device locator plus large-print binding pages. Dense diagrams
 * remain useful for locating controls while the companion pages keep every
 * configured function readable at DCS and VR kneeboard scale.
 */
export function renderSharedHardwarePages(options) {
  const { deviceId, labels = {}, title, kicker = '', provenance, footer = '', commonRoot } = options;
  const overview = renderSharedHardwarePage(options);
  const { device, svg, calloutIds } = loadSharedHardware(deviceId, { commonRoot });
  const values = Array.isArray(labels)
    ? Object.fromEntries(calloutIds.map((id, index) => [id, labels[index] ?? '']))
    : labels;
  const hardwareLabels = new Map([...svg.matchAll(/<text id="lbl-([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => [match[1], match[2].replace(/<[^>]+>/g, '').trim()]));
  const entries = calloutIds.map((id) => ({
    id,
    hardwareLabel: hardwareLabels.get(id) || id,
    functionLabel: displayLabel(values[id]),
  })).filter((entry) => entry.functionLabel.trim());
  if (entries.length === 0) return [{ file: options.file, svg: overview.svg, kind: 'locator' }];

  const pageFooter = provenance ? formatProvenanceFooter({ commonRoot, ...provenance }) : footer;
  const pages = [{ file: options.file, svg: overview.svg, kind: 'locator' }];
  for (let offset = 0; offset < entries.length; offset += READABLE_BINDINGS_PER_PAGE) {
    const pageNumber = Math.floor(offset / READABLE_BINDINGS_PER_PAGE) + 1;
    const pageCount = Math.ceil(entries.length / READABLE_BINDINGS_PER_PAGE);
    pages.push({
      file: `${options.file}-BINDINGS-${pageNumber}`,
      kind: 'bindings',
      svg: renderReadableBindingsPage({
        deviceId: device.id,
        title: title ?? device.label,
        kicker: `${kicker ? `${kicker} • ` : ''}READABLE BINDINGS ${pageNumber} / ${pageCount}`,
        entries: entries.slice(offset, offset + READABLE_BINDINGS_PER_PAGE),
        footer: pageFooter,
      }),
    });
  }
  return pages;
}

export function renderSharedHardwareInstancesPage({ instances, title, kicker = '', footer = '', provenance, commonRoot }) {
  if (!Array.isArray(instances) || instances.length === 0) throw new Error('At least one shared hardware instance is required.');
  const rendered = instances.map((instance, index) => {
    const { device, svg, calloutIds } = loadSharedHardware(instance.deviceId, { commonRoot, labels: instance.labels, labelColors: instance.labelColors });
    return {
      ...instance,
      device,
      calloutIds,
      instanceId: instance.instanceId ?? `${instance.deviceId}-${index + 1}`,
      encoded: Buffer.from(svg).toString('base64'),
    };
  });
  const pageFooter = provenance ? formatProvenanceFooter({ commonRoot, ...provenance }) : footer;
  // Shared device SVGs are landscape (e.g. 960×640). A tall portrait slot
  // (old default 540×1180) letterboxed the diagram and clipped top callouts.
  // Keep ~3:2 so callouts stay visible inside each instance card.
  const defaultWidth = 560;
  const defaultHeight = 400;
  return {
    instances: rendered.map(({ instanceId, deviceId, calloutIds }) => ({ instanceId, deviceId, calloutIds })),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <desc>Shared DCS-Common instances: ${rendered.map(({ instanceId, deviceId }) => `${escapeXml(instanceId)}=${escapeXml(deviceId)}`).join(', ')}</desc>
  <rect width="1200" height="1600" fill="#06101d"/>
  <rect width="1200" height="16" fill="#46d8ff"/>
  <text x="54" y="80" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#f5f9ff">${escapeXml(title)}</text>
  <text x="56" y="126" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#ffc95c">${escapeXml(kicker)}</text>
${rendered.map((instance, index) => {
  const width = instance.width ?? defaultWidth;
  const height = instance.height ?? defaultHeight;
  const x = instance.x ?? 40 + index * (width + 20);
  const y = instance.y ?? 280;
  const label = escapeXml(instance.title ?? instance.device.label);
  return `  <g data-instance="${escapeXml(instance.instanceId)}"><text x="${x + width / 2}" y="${y - 18}" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#8fdfff">${label}</text><image href="data:image/svg+xml;base64,${instance.encoded}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></g>`;
}).join('\n')}
  <text x="54" y="1570" font-family="Arial,sans-serif" font-size="18" fill="#8ea5bd">${escapeXml(pageFooter)}</text>
</svg>`,
  };
}
