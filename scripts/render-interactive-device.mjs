import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { loadSharedHardware } from './shared-hardware-consumer.mjs';
import { loadCalloutCatalog, loadDeviceMap } from './scaffold-consumer.mjs';

const commonRoot = resolve(import.meta.dirname, '..');
export function interactiveDevice(deviceId) {
  const { svg, device } = loadSharedHardware(deviceId, { commonRoot });
  const drawio = readFileSync(join(commonRoot, 'assets/shared/hardware', device.drawio), 'utf8');
  const catalog = loadCalloutCatalog(commonRoot, deviceId);
  const aliases = loadDeviceMap(commonRoot).inputKeyAliases?.[deviceId] ?? {};
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const viewBox = attr(svg.match(/<svg\b[^>]*>/)[0], 'viewBox').split(/\s+/).map(Number);
  const controls = [];
  for (const match of svg.matchAll(/<text\b[^>]*id="lbl-([^"]+)"[^>]*>[\s\S]*?<\/text>/g)) {
    const id = match[1];
    const control = catalog.controls.find((item) => item.id === id || `${item.id}-shifted` === id);
    if (!control) continue;
    const tag = match[0].split('>')[0];
    const font = Number(attr(tag, 'font-size') ?? 10);
    const cell = [...drawio.matchAll(/<mxCell\b[^>]*>[\s\S]*?<\/mxCell>/g)].find((cell) => attr(cell[0].split('>')[0], 'id') === `label-${id}`)?.[0];
    const geometry = cell?.match(/<mxGeometry\b[^>]*>/)?.[0];
    const width = Number(geometry && attr(geometry, 'width')) || Math.max(50, font * 6);
    const height = Number(geometry && attr(geometry, 'height')) || Math.max(16, font * 1.5);
    const x = geometry ? Number(attr(geometry, 'x') ?? 0) : Number(attr(tag, 'x')) - width / 2;
    const y = geometry ? Number(attr(geometry, 'y') ?? 0) : Number(attr(tag, 'y')) - height * .75;
    controls.push({ ...control, id, key: Object.keys(aliases).find((key) => aliases[key] === control.key) ?? control.key,
      x, y, width, height, fontSize: Math.min(font, Math.max(8, width / 7)),
      anchor: attr(tag, 'text-anchor') ?? 'start', shifted: id.endsWith('-shifted') });
  }
  const background = svg.replace(/<text\b[^>]*id="lbl-[^"]+"[^>]*>[\s\S]*?<\/text>/g, '');
  return { width: viewBox[2], height: viewBox[3], controls, background };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [deviceId, pngPath] = process.argv.slice(2);
  const { background, ...layout } = interactiveDevice(deviceId);
  await sharp(Buffer.from(background)).png().toFile(pngPath);
  console.log(JSON.stringify(layout));
}
