import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets/shared/hardware/manifest.json'), 'utf8'));
const hardwareRoot = join(root, 'assets/shared/hardware');
const outDir = join(hardwareRoot, 'drawio');
const force = process.argv.includes('--force');
const requestedIds = new Set(process.argv.slice(2).filter((argument) => argument !== '--force'));

mkdirSync(outDir, { recursive: true });

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const attr = (source, name) => {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1];
};

function geometry(x, y, width, height) {
  return `          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>`;
}

function parseSvg(svg) {
  const rootTag = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!rootTag) throw new Error('Missing SVG root');
  const width = Number(attr(rootTag, 'width'));
  const height = Number(attr(rootTag, 'height'));
  const background = svg.match(/<rect\s+width="[^"]+"\s+height="[^"]+"\s+fill="([^"]+)"\s*\/>/)?.[1] ?? '#0f172a';
  const footer = [...svg.matchAll(/<text\s+x="[^"]+"\s+y="[^"]+"[^>]*>([^<]*)<\/text>/g)].at(-1)?.[1] ?? '';
  const images = [...svg.matchAll(/<image\b[^>]*\/>/g)].map(({ 0: tag }) => ({
    href: attr(tag, 'href'),
    x: Number(attr(tag, 'x')),
    y: Number(attr(tag, 'y')),
    width: Number(attr(tag, 'width')),
    height: Number(attr(tag, 'height')),
  }));
  const callouts = [...svg.matchAll(/<!-- callout:([^\s]+) -->\s*<line\b([^>]*)\/>\s*<circle\b([^>]*)\/>\s*<rect\b([^>]*)\/>\s*<text\b([^>]*)><\/text>/g)]
    .map((match) => ({
      id: match[1],
      anchorX: Number(attr(match[3], 'cx')),
      anchorY: Number(attr(match[3], 'cy')),
      x: Number(attr(match[4], 'x')),
      y: Number(attr(match[4], 'y')),
      width: Number(attr(match[4], 'width')),
      height: Number(attr(match[4], 'height')),
    }));
  return { width, height, background, footer, images, callouts };
}

function toDrawio(device, model) {
  const drawioImage = (href) => href.replace(';base64,', ',');
  const cells = [
    `        <mxCell id="canvas" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${model.background};strokeColor=none;" vertex="1" parent="1">\n${geometry(0, 0, model.width, model.height)}\n        </mxCell>`,
    ...model.images.map((image, index) =>
      `        <mxCell id="hardware-image-${index + 1}" value="" style="shape=image;whiteSpace=wrap;html=1;aspect=fixed;image=${esc(drawioImage(image.href))};" vertex="1" parent="1">\n${geometry(image.x, image.y, image.width, image.height)}\n        </mxCell>`),
    ...model.callouts.flatMap((callout) => [
      `        <mxCell id="anchor-${esc(callout.id)}" value="" style="ellipse;whiteSpace=wrap;html=1;fillColor=#00bfff;strokeColor=#0f172a;strokeWidth=1.5;" vertex="1" parent="1">\n${geometry(callout.anchorX - 5, callout.anchorY - 5, 10, 10)}\n        </mxCell>`,
      `        <mxCell id="label-${esc(callout.id)}" value="" style="rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=#1e293b;strokeColor=#00bfff;strokeWidth=1.5;fontColor=#f1f5f9;fontFamily=Arial;fontSize=11;align=center;verticalAlign=middle;" vertex="1" parent="1">\n${geometry(callout.x, callout.y, callout.width, callout.height)}\n        </mxCell>`,
      `        <mxCell id="connector-${esc(callout.id)}" value="" style="endArrow=none;html=1;strokeColor=#00bfff;strokeWidth=1.5;dashed=1;dashPattern=5 3;opacity=75;" edge="1" source="label-${esc(callout.id)}" target="anchor-${esc(callout.id)}" parent="1">\n          <mxGeometry relative="1" as="geometry"/>\n        </mxCell>`,
    ]),
    `        <mxCell id="footer" value="${esc(model.footer)}" style="text;html=1;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=12;fontColor=#475569;strokeColor=none;fillColor=none;" vertex="1" parent="1">\n${geometry(0, model.height - 24, model.width, 20)}\n        </mxCell>`,
  ];

  return `<mxfile host="app.diagrams.net" type="device" compressed="false">
  <diagram id="${esc(device.id)}" name="${esc(device.label)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${model.width}" pageHeight="${model.height}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

let written = 0;
for (const device of manifest.devices.filter((entry) => entry.drawio && (!requestedIds.size || requestedIds.has(entry.id)))) {
  const svgPath = join(hardwareRoot, device.svg);
  const drawioPath = join(hardwareRoot, device.drawio);
  if (existsSync(drawioPath) && !force) {
    console.log(`skip ${device.id}: source already exists (use --force to replace)`);
    continue;
  }
  const model = parseSvg(readFileSync(svgPath, 'utf8'));
  if (!model.images.length || !model.callouts.length) {
    throw new Error(`${device.id}: expected an image-backed SVG with callouts`);
  }
  writeFileSync(drawioPath, toDrawio(device, model), 'utf8');
  console.log(`wrote ${device.drawio} (${model.callouts.length} callouts)`);
  written += 1;
}
console.log(`Created ${written} native draw.io source file(s).`);
