import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const escapeXml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export function resolveDcsCommonRoot(consumerRoot = process.cwd()) {
  const candidates = [process.env.DCS_COMMON_ROOT, join(consumerRoot, '.dcs-common')].filter(Boolean);
  const root = candidates.find((candidate) => existsSync(join(candidate, 'assets/shared/hardware/manifest.json')));
  if (!root) throw new Error('DCS-Common shared assets are unavailable. Set DCS_COMMON_ROOT or check out DCS-Common at .dcs-common.');
  return resolve(root);
}

export function loadSharedHardware(deviceId, { commonRoot = resolveDcsCommonRoot(), labels = {} } = {}) {
  const hardwareRoot = join(commonRoot, 'assets/shared/hardware');
  const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
  const device = manifest.devices.find((entry) => entry.id === deviceId);
  if (!device) throw new Error(`Unknown shared hardware device: ${deviceId}`);
  let svg = readFileSync(join(hardwareRoot, device.svg), 'utf8');
  const calloutIds = [...svg.matchAll(/<text id="lbl-([^"]+)"/g)].map((match) => match[1]);
  const values = Array.isArray(labels)
    ? Object.fromEntries(calloutIds.map((id, index) => [id, labels[index] ?? '']))
    : labels;
  for (const id of calloutIds) {
    const value = escapeXml(values[id] ?? '');
    svg = svg.replace(new RegExp(`(<text id="lbl-${id}"[^>]*>)[\\s\\S]*?(</text>)`), `$1${value}$2`);
  }
  return { device, svg, calloutIds };
}

export function renderSharedHardwarePage({ deviceId, labels = {}, title, kicker = '', footer = '', commonRoot }) {
  const { device, svg, calloutIds } = loadSharedHardware(deviceId, { commonRoot, labels });
  const encoded = Buffer.from(svg).toString('base64');
  const pageTitle = escapeXml(title ?? device.label);
  return {
    calloutIds,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <desc>Shared DCS-Common device: ${escapeXml(deviceId)}</desc>
  <rect width="1200" height="1600" fill="#06101d"/>
  <rect width="1200" height="16" fill="#46d8ff"/>
  <text x="54" y="80" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#f5f9ff">${pageTitle}</text>
  <text x="56" y="126" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#ffc95c">${escapeXml(kicker)}</text>
  <image href="data:image/svg+xml;base64,${encoded}" x="35" y="155" width="1130" height="1350" preserveAspectRatio="xMidYMid meet"/>
  <text x="54" y="1570" font-family="Arial,sans-serif" font-size="18" fill="#8ea5bd">${escapeXml(footer)}</text>
</svg>`,
  };
}

export function renderSharedHardwareInstancesPage({ instances, title, kicker = '', footer = '', commonRoot }) {
  if (!Array.isArray(instances) || instances.length === 0) throw new Error('At least one shared hardware instance is required.');
  const rendered = instances.map((instance, index) => {
    const { device, svg, calloutIds } = loadSharedHardware(instance.deviceId, { commonRoot, labels: instance.labels });
    return {
      ...instance,
      device,
      calloutIds,
      instanceId: instance.instanceId ?? `${instance.deviceId}-${index + 1}`,
      encoded: Buffer.from(svg).toString('base64'),
    };
  });
  const defaultWidth = 540;
  const defaultHeight = 1180;
  return {
    instances: rendered.map(({ instanceId, deviceId, calloutIds }) => ({ instanceId, deviceId, calloutIds })),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <desc>Shared DCS-Common instances: ${rendered.map(({ instanceId, deviceId }) => `${escapeXml(instanceId)}=${escapeXml(deviceId)}`).join(', ')}</desc>
  <rect width="1200" height="1600" fill="#06101d"/>
  <rect width="1200" height="16" fill="#46d8ff"/>
  <text x="54" y="80" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#f5f9ff">${escapeXml(title)}</text>
  <text x="56" y="126" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#ffc95c">${escapeXml(kicker)}</text>
${rendered.map((instance, index) => {
  const x = instance.x ?? 40 + index * 570;
  const y = instance.y ?? 190;
  const width = instance.width ?? defaultWidth;
  const height = instance.height ?? defaultHeight;
  const label = escapeXml(instance.title ?? instance.device.label);
  return `  <g data-instance="${escapeXml(instance.instanceId)}"><text x="${x + width / 2}" y="${y - 18}" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#8fdfff">${label}</text><image href="data:image/svg+xml;base64,${instance.encoded}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></g>`;
}).join('\n')}
  <text x="54" y="1570" font-family="Arial,sans-serif" font-size="18" fill="#8ea5bd">${escapeXml(footer)}</text>
</svg>`,
  };
}
