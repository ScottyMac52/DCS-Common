import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const hardwareRoot = join(root, 'assets/shared/hardware');
const image = (name) => `data:image/png;base64,${readFileSync(join(hardwareRoot, 'source', name)).toString('base64')}`;
const callouts = [
  ['vaicom',360,180,20,90], ['uncage',635,190,790,90], ['range-antenna',660,240,790,140], ['speed-brake',680,300,790,190],
  ['dogfight',670,350,790,240], ['dcs-switch',570,360,20,190], ['radar-cursor',625,440,790,290], ['enable',625,485,790,340],
  ['dispense',470,520,20,290], ['idle-detent',420,560,20,390], ['emergency-jettison',430,735,20,650], ['landing-gear',625,750,790,650],
  ['master-arm',430,810,20,710], ['cmds-program',595,820,790,710], ['cmds-mode',685,820,790,770], ['rwr',430,875,20,770],
  ['zoom',620,885,790,830], ['stores-cat',470,925,20,830], ['rf',430,960,20,890], ['exterior-lights',690,960,790,890],
  ['laser',475,1000,20,950], ['jammer',600,1000,790,950], ['heading',690,1040,790,1010], ['autopilot',540,1080,20,1010],
];
const markup = callouts.map(([id,ax,ay,x,y]) => `  <!-- callout:viper-tqs-${id} -->\n  <line x1="${ax}" y1="${ay}" x2="${x < 100 ? x + 170 : x}" y2="${y + 22}" stroke="#00bfff" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.75"/>\n  <circle cx="${ax}" cy="${ay}" r="5" fill="#00bfff" stroke="#0f172a" stroke-width="1.5"/>\n  <rect x="${x}" y="${y}" width="170" height="44" rx="4" fill="#1e293b" stroke="#00bfff" stroke-width="1.5"/>\n  <text id="lbl-viper-tqs-${id}" x="${x + 85}" y="${y + 15}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#f1f5f9"></text>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200" viewBox="0 0 1000 1200">
  <rect width="1000" height="1200" fill="#0f172a"/>
  <image href="${image('viper-tqs-handle-controls.png')}" x="250" y="55" width="500" height="550" preserveAspectRatio="xMidYMid meet"/>
  <image href="${image('viper-mission-pack-controls.png')}" x="220" y="620" width="560" height="500" preserveAspectRatio="xMidYMid meet"/>
${markup}
  <text x="500" y="1192" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#475569">Viper TQS + Mission Pack • canonical shared template</text>
</svg>`;
writeFileSync(join(hardwareRoot, 'svg/viper-tqs-mission-pack.svg'), svg);
