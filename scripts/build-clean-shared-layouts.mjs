import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hardwareRoot = join(root, 'assets', 'shared', 'hardware');

const esc = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const image = (name) => `data:image/png,${readFileSync(join(hardwareRoot, 'source', name)).toString('base64')}`;
const geometry = ({ x, y, width, height }) =>
  `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>`;

function controls(deviceId) {
  const lua = readFileSync(join(hardwareRoot, 'lua', `${deviceId}.lua`), 'utf8');
  return [...lua.matchAll(/\{\s*id = "([^"]+)",\s*key = "([^"]+)",\s*type = "([^"]+)",\s*hardwareLabel = "([^"]+)"/g)]
    .map((match) => ({ id: match[1], label: match[4] }));
}

function drawio({ id, width = 1200, height = 900, images, callouts, footer }) {
  const cells = [
    `<mxCell id="canvas" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#0f172a;strokeColor=none;" vertex="1" parent="1">${geometry({ x: 0, y: 0, width, height })}</mxCell>`,
    ...images.map((entry, index) =>
      `<mxCell id="hardware-image-${index + 1}" value="" style="shape=image;whiteSpace=wrap;html=1;aspect=fixed;image=${image(entry.name)};" vertex="1" parent="1">${geometry(entry)}</mxCell>`),
    ...callouts.flatMap((entry) => [
      `<mxCell id="anchor-${esc(entry.id)}" value="" style="ellipse;whiteSpace=wrap;html=1;fillColor=#00bfff;strokeColor=#0f172a;strokeWidth=1.5;" vertex="1" parent="1">${geometry({ x: entry.anchor[0] - 5, y: entry.anchor[1] - 5, width: 10, height: 10 })}</mxCell>`,
      `<mxCell id="label-${esc(entry.id)}" value="${esc(entry.label)}" style="rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=#1e293b;strokeColor=#00bfff;strokeWidth=1.5;fontColor=#f1f5f9;fontFamily=Arial;fontSize=12;align=center;verticalAlign=middle;" vertex="1" parent="1">${geometry(entry.card)}</mxCell>`,
      `<mxCell id="connector-${esc(entry.id)}" value="" style="endArrow=none;html=1;strokeColor=#00bfff;strokeWidth=1.5;dashed=1;dashPattern=5 3;opacity=75;" edge="1" source="label-${esc(entry.id)}" target="anchor-${esc(entry.id)}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    ]),
    `<mxCell id="footer" value="${esc(footer)}" style="text;html=1;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=12;fontColor=#475569;strokeColor=none;fillColor=none;" vertex="1" parent="1">${geometry({ x: 0, y: height - 24, width, height: 20 })}</mxCell>`,
  ];
  return `<mxfile host="app.diagrams.net" type="device" compressed="false">
  <diagram id="${id}" name="${id}">
    <mxGraphModel dx="1400" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${width}" pageHeight="${height}" math="0" shadow="0">
      <root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

function cards(items) {
  return items.map((item, index) => {
    const left = index % 2 === 0;
    const row = Math.floor(index / 2);
    return { ...item, card: { x: left ? 20 : 880, y: 70 + row * 58, width: 300, height: 44 } };
  });
}

const mfdControls = controls('tm-mfd');
const mfdAnchors = new Map();
['t', 'r', 'b', 'l'].forEach((side) => {
  for (let index = 1; index <= 5; index += 1) {
    const point = side === 't' ? [480 + (index - 1) * 60, 565]
      : side === 'r' ? [750, 625 + (index - 1) * 60]
        : side === 'b' ? [720 - (index - 1) * 60, 865]
          : [450, 865 - (index - 1) * 60];
    mfdAnchors.set(`mfd-osb-${side}${index}`, point);
    mfdAnchors.set(`mfd-osb-${side}${index}-shifted`, point);
  }
});
Object.assign(mfdAnchors, {});
const rockerAnchors = {
  'mfd-rocker-gain': [410, 545], 'mfd-rocker-lvl': [410, 595],
  'mfd-rocker-sym': [790, 545], 'mfd-rocker-int': [790, 595],
  'mfd-rocker-brt-up': [410, 860], 'mfd-rocker-brt-down': [410, 910],
  'mfd-rocker-con-up': [790, 860], 'mfd-rocker-con-down': [790, 910],
};
for (const [id, anchor] of Object.entries(rockerAnchors)) mfdAnchors.set(id, anchor);
const mfdVisuals = [...mfdControls, ...mfdControls.filter(({ id }) => id.startsWith('mfd-osb-')).map((entry) => ({ ...entry, id: `${entry.id}-shifted` }))];
const mfdCallouts = cards(mfdVisuals).map((entry) => ({ ...entry, anchor: mfdAnchors.get(entry.id) }));
writeFileSync(join(hardwareRoot, 'drawio', 'tm-mfd.drawio'), drawio({
  id: 'tm-mfd',
  height: 1500,
  images: [{ name: 'mfd-clean.png', x: 390, y: 500, width: 420, height: 420 }],
  callouts: mfdCallouts,
  footer: 'Thrustmaster Cougar MFD',
}));

const gripAnchors = {
  'warthog-grip-btn-red': [505, 170], 'warthog-grip-tms-up': [475, 220],
  'warthog-grip-tms-right': [490, 230], 'warthog-grip-tms-down': [475, 240],
  'warthog-grip-tms-left': [460, 230], 'warthog-grip-trim-up': [565, 180],
  'warthog-grip-trim-right': [580, 190], 'warthog-grip-trim-down': [565, 200],
  'warthog-grip-trim-left': [550, 190], 'warthog-grip-rear-btn': [690, 590],
  'warthog-grip-dms-up': [545, 235], 'warthog-grip-dms-right': [560, 245],
  'warthog-grip-dms-down': [545, 255], 'warthog-grip-dms-left': [530, 245],
  'warthog-grip-cms-forward': [700, 625], 'warthog-grip-cms-right': [715, 635],
  'warthog-grip-cms-aft': [700, 645], 'warthog-grip-cms-left': [685, 635],
  'warthog-grip-cms-push': [700, 635], 'warthog-grip-stage1': [600, 315],
  'warthog-grip-stage2': [605, 325], 'warthog-grip-pinky': [470, 390],
  'warthog-grip-paddle': [675, 705], 'warthog-grip-rear-sw1': [500, 700],
  'warthog-grip-rear-sw2': [530, 700],
};
const gripCallouts = cards(controls('tm-warthog-grip')).map((entry) => ({ ...entry, anchor: gripAnchors[entry.id] }));
writeFileSync(join(hardwareRoot, 'drawio', 'tm-warthog-grip.drawio'), drawio({
  id: 'tm-warthog-grip',
  images: [
    { name: 'f16c-warthog-grip-front.png', x: 435, y: 125, width: 330, height: 535 },
    { name: 'f16c-warthog-grip-rear.png', x: 640, y: 565, width: 170, height: 230 },
  ],
  callouts: gripCallouts,
  footer: 'TM Warthog Joystick',
}));

console.log('Rebuilt clean shared layouts for tm-mfd and tm-warthog-grip.');
