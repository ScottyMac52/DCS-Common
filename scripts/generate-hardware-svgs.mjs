/**
 * Generates shared hardware SVG templates.
 *
 * Each SVG embeds the source image as a base64 data URI so it renders in all
 * contexts (browser, GitHub, embedded HTML). Callout lines point to actual
 * controls on the device; the label <text> elements are intentionally empty so
 * downstream repos fill them in with their own binding names.
 *
 * Usage:  node scripts/generate-hardware-svgs.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'assets/shared/hardware/source');
const outDir = join(root, 'assets/shared/hardware/svg');

// ── Theme ────────────────────────────────────────────────────────────────────
const ACCENT = '#00bfff';
const BG     = '#0f172a';
const CARD   = '#1e293b';
const TXT    = '#f1f5f9';
const FOOTER = '#475569';
const LW     = 160;  // label box width
const LH     = 22;   // label box height

// ── Helpers ──────────────────────────────────────────────────────────────────
function encode(file) {
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(join(srcDir, file)).toString('base64')}`;
}

/**
 * Build one callout.
 * Direction is inferred from which axis dominates the (cx→lx, cy→ly) vector.
 *  horizontal-dominant: label box is to the left or right of the line end
 *  vertical-dominant:   label box is above or below the line end, centred on lx
 */
function callout(id, cx, cy, lx, ly) {
  const dx = Math.abs(lx - cx);
  const dy = Math.abs(ly - cy);
  let bx, by;
  if (dy > dx) {
    // vertical-dominant — box centred on lx
    bx = Math.max(2, lx - Math.floor(LW / 2));
    by = ly < cy ? ly - LH : ly;   // above line if going up, below if going down
  } else if (lx >= cx) {
    // going right
    bx = lx;
    by = ly - Math.floor(LH / 2);
  } else {
    // going left
    bx = Math.max(2, lx - LW);
    by = ly - Math.floor(LH / 2);
  }
  const tx = bx + Math.floor(LW / 2);
  const ty = by + 15;
  return [
    `  <!-- callout:${id} -->`,
    `  <line x1="${cx}" y1="${cy}" x2="${lx}" y2="${ly}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.75"/>`,
    `  <circle cx="${cx}" cy="${cy}" r="5" fill="${ACCENT}" stroke="${BG}" stroke-width="1.5"/>`,
    `  <rect x="${bx}" y="${by}" width="${LW}" height="${LH}" rx="4" fill="${CARD}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    `  <text id="lbl-${id}" x="${tx}" y="${ty}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="${TXT}"></text>`,
  ].join('\n');
}

function render({ id, footer, W, H, images, callouts = [], noImg = false }) {
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `  <rect width="${W}" height="${H}" fill="${BG}"/>`,
  ];
  if (noImg) {
    lines.push(`  <rect x="60" y="40" width="${W - 120}" height="${H - 90}" rx="12" fill="${CARD}" stroke="#334155" stroke-width="2"/>`);
    lines.push(`  <text x="${W / 2}" y="${H / 2 - 16}" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#64748b">No source image available.</text>`);
    lines.push(`  <text x="${W / 2}" y="${H / 2 + 8}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#475569">Add source image to assets/shared/hardware/source/</text>`);
  } else {
    for (const im of images) {
      lines.push(`  <image href="${im.href}" x="${im.x}" y="${im.y}" width="${im.w}" height="${im.h}" preserveAspectRatio="xMidYMid meet"/>`);
    }
    for (const c of callouts) {
      lines.push(callout(`${id}-${c.id}`, c.cx, c.cy, c.lx, c.ly));
    }
  }
  lines.push(`  <text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${FOOTER}">${footer}</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

function write(filename, spec) {
  const content = render(spec);
  writeFileSync(join(outDir, filename), content, 'utf8');
  console.log(`  wrote ${filename}  (${Math.round(content.length / 1024)}KB)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Device specs
// ─────────────────────────────────────────────────────────────────────────
// cx, cy = control position in SVG canvas coords (inside the rendered image)
// lx, ly = label line endpoint
//   lx > cx  → label box RIGHT of the line end
//   lx < cx  → label box LEFT  of the line end (bx = lx-LW)
//   ly < cy  → label box ABOVE the line end  (vertical, centred on lx)
//   ly > cy  → label box BELOW the line end  (vertical, centred on lx)
// Spacing rule: adjacent labels on the same side must be ≥ LH(22) px apart.
// ═══════════════════════════════════════════════════════════════════════════

// ── vkb-f14-gunfighter ───────────────────────────────────────────────────────
// Source: vkb-grip-clean.png  ~530 × 730 px (portrait)
// Canvas: 700 × 800, image: x=195 y=15 w=310 h=740
{
  const img = encode('vkb-grip-clean.png');
  const ix = 195, iy = 15, iw = 310, ih = 740;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const RL = 545;  // right label lx
  const LL = 165;  // left  label lx  (bx = 165-160 = 5)
  write('vkb-f14-gunfighter.svg', {
    id: 'vkb', footer: 'VKB F-14 Gunfighter Grip', W: 700, H: 800,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // top area — right labels, staggered every 24 px
      { id: 'hat',       cx: px(.47), cy: py(.03), lx: RL, ly: 36  },
      { id: 'btn-red',   cx: px(.82), cy: py(.05), lx: RL, ly: 60  },
      { id: 'castle',    cx: px(.65), cy: py(.10), lx: RL, ly: 84  },
      { id: 'btn-a',     cx: px(.80), cy: py(.16), lx: RL, ly: 108 },
      // left switch bank — left labels
      { id: 'sw1',       cx: px(.10), cy: py(.17), lx: LL, ly: 138 },
      { id: 'sw2',       cx: px(.10), cy: py(.22), lx: LL, ly: 162 },
      { id: 'sw3',       cx: px(.10), cy: py(.29), lx: LL, ly: 186 },
      { id: 'sw4',       cx: px(.10), cy: py(.37), lx: LL, ly: 210 },
      // grip body controls
      { id: 'paddle',    cx: px(.14), cy: py(.52), lx: LL, ly: 395 },
      { id: 'pinky',     cx: px(.13), cy: py(.61), lx: LL, ly: 465 },
      // trigger + lower right
      { id: 'grip-r',    cx: px(.81), cy: py(.38), lx: RL, ly: 295 },
      { id: 'stage1',    cx: px(.73), cy: py(.57), lx: RL, ly: 430 },
      { id: 'stage2',    cx: px(.73), cy: py(.64), lx: RL, ly: 475 },
    ],
  });
}

// ── f4u-vkb-grip ─────────────────────────────────────────────────────────────
// Same hardware; F4U-1D module binding context
{
  const img = encode('f4u-vkb-grip-clean.png');
  const ix = 195, iy = 15, iw = 310, ih = 740;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const RL = 545, LL = 165;
  write('f4u-vkb-grip.svg', {
    id: 'f4u-vkb', footer: 'F4U-1D — VKB F-14 Gunfighter Grip', W: 700, H: 800,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'hat',       cx: px(.47), cy: py(.03), lx: RL, ly: 36  },
      { id: 'btn-red',   cx: px(.82), cy: py(.05), lx: RL, ly: 60  },
      { id: 'castle',    cx: px(.65), cy: py(.10), lx: RL, ly: 84  },
      { id: 'btn-a',     cx: px(.80), cy: py(.16), lx: RL, ly: 108 },
      { id: 'sw1',       cx: px(.10), cy: py(.17), lx: LL, ly: 138 },
      { id: 'sw2',       cx: px(.10), cy: py(.22), lx: LL, ly: 162 },
      { id: 'sw3',       cx: px(.10), cy: py(.29), lx: LL, ly: 186 },
      { id: 'sw4',       cx: px(.10), cy: py(.37), lx: LL, ly: 210 },
      { id: 'paddle',    cx: px(.14), cy: py(.52), lx: LL, ly: 395 },
      { id: 'pinky',     cx: px(.13), cy: py(.61), lx: LL, ly: 465 },
      { id: 'grip-r',    cx: px(.81), cy: py(.38), lx: RL, ly: 295 },
      { id: 'stage1',    cx: px(.73), cy: py(.57), lx: RL, ly: 430 },
      { id: 'stage2',    cx: px(.73), cy: py(.64), lx: RL, ly: 475 },
    ],
  });
}

// ── warthog-grip-f16c ────────────────────────────────────────────────────────
// Source: front ~530×680 portrait, rear ~530×450 portrait
// Canvas: 960 × 580  front: x=55 y=20 w=210 h=530  rear: x=310 y=20 w=190 h=440
{
  const front = encode('f16c-warthog-grip-front.png');
  const rear  = encode('f16c-warthog-grip-rear.png');
  const fix = 55,  fiy = 20, fiw = 210, fih = 530;
  const rix = 310, riy = 20, riw = 190, rih = 440;
  const fpx = (f) => Math.round(fix + f * fiw);
  const fpy = (f) => Math.round(fiy + f * fih);
  const rpx = (f) => Math.round(rix + f * riw);
  const rpy = (f) => Math.round(riy + f * rih);
  const FL = 20;   // front left label lx
  const FR = 295;  // front right label lx (beside image, before rear starts at 310)
  const RR = 800;  // rear right label lx
  write('warthog-grip-f16c.svg', {
    id: 'wg-f16c', footer: 'Warthog Grip — F-16C profile  (front | rear)', W: 960, H: 580,
    images: [
      { href: front, x: fix, y: fiy, w: fiw, h: fih },
      { href: rear,  x: rix, y: riy, w: riw, h: rih },
    ],
    callouts: [
      // front — left labels
      { id: 'btn-red',    cx: fpx(.28), cy: fpy(.07), lx: FL, ly: 36  },
      { id: 'hat',        cx: fpx(.55), cy: fpy(.12), lx: FL, ly: 60  },
      { id: 'trim-wheel', cx: fpx(.13), cy: fpy(.22), lx: FL, ly: 84  },
      { id: 'paddle',     cx: fpx(.07), cy: fpy(.40), lx: FL, ly: 108 },
      { id: 'pinky',      cx: fpx(.42), cy: fpy(.48), lx: FL, ly: 295 },
      // front — right labels (between front and rear images)
      { id: 'dcs-hat',    cx: fpx(.60), cy: fpy(.25), lx: FR, ly: 36  },
      { id: 'boat-sw',    cx: fpx(.70), cy: fpy(.36), lx: FR, ly: 60  },
      { id: 'china-hat',  cx: fpx(.68), cy: fpy(.44), lx: FR, ly: 84  },
      { id: 'stage1',     cx: fpx(.73), cy: fpy(.54), lx: FR, ly: 190 },
      { id: 'stage2',     cx: fpx(.73), cy: fpy(.62), lx: FR, ly: 214 },
      // rear — right labels
      { id: 'rear-sw1',   cx: rpx(.45), cy: rpy(.18), lx: RR, ly: 36  },
      { id: 'rear-sw2',   cx: rpx(.45), cy: rpy(.30), lx: RR, ly: 60  },
      { id: 'rear-sw3',   cx: rpx(.45), cy: rpy(.42), lx: RR, ly: 84  },
      { id: 'rear-btn',   cx: rpx(.65), cy: rpy(.55), lx: RR, ly: 108 },
    ],
  });
}

// ── winctrl-icp-f16c ─────────────────────────────────────────────────────────
// Source: f16c-icp-clean.png  ~975 × 1000 px (nearly square)
// Canvas: 960 × 660, image: x=195 y=10 w=570 h=585
{
  const img = encode('f16c-icp-clean.png');
  const ix = 195, iy = 10, iw = 570, ih = 585;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 165, RL = 800;
  write('winctrl-icp-f16c.svg', {
    id: 'icp-f16c', footer: 'WINCTRL ICP — F-16C profile', W: 960, H: 660,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // top function row — left labels
      { id: 'com1',    cx: px(.27), cy: py(.44), lx: LL, ly: 265 },
      { id: 'com2',    cx: px(.36), cy: py(.44), lx: LL, ly: 289 },
      { id: 'iff',     cx: px(.47), cy: py(.44), lx: LL, ly: 313 },
      // top function row — right labels
      { id: 'list',    cx: px(.57), cy: py(.44), lx: RL, ly: 265 },
      { id: 'a-a',     cx: px(.65), cy: py(.44), lx: RL, ly: 289 },
      { id: 'a-g',     cx: px(.73), cy: py(.44), lx: RL, ly: 313 },
      // numpad row 1 — left
      { id: 'kp-1',    cx: px(.27), cy: py(.56), lx: LL, ly: 337 },
      { id: 'kp-2',    cx: px(.38), cy: py(.56), lx: LL, ly: 361 },
      { id: 'kp-3',    cx: px(.47), cy: py(.56), lx: LL, ly: 385 },
      // numpad row 1 — right
      { id: 'rcl',     cx: px(.57), cy: py(.56), lx: RL, ly: 337 },
      { id: 'entr',    cx: px(.64), cy: py(.62), lx: RL, ly: 361 },
      // numpad row 2 — left
      { id: 'kp-4',    cx: px(.27), cy: py(.67), lx: LL, ly: 409 },
      { id: 'kp-5',    cx: px(.38), cy: py(.67), lx: LL, ly: 433 },
      { id: 'kp-6',    cx: px(.47), cy: py(.67), lx: LL, ly: 457 },
      // scroll / action row — right
      { id: 'dcs-up',  cx: px(.14), cy: py(.80), lx: RL, ly: 481 },
      { id: 'rtn',     cx: px(.39), cy: py(.88), lx: RL, ly: 505 },
      { id: 'seq',     cx: px(.47), cy: py(.88), lx: RL, ly: 529 },
    ],
  });
}

// ── winctrl-pto2 ─────────────────────────────────────────────────────────────
// Source: pto2-clean.png  landscape carrier/flight-controls panel
// Canvas: 960 × 600, image: x=40 y=30 w=880 h=500
// Vertical callouts go UP (to top margin) or DOWN (to bottom margin).
{
  const img = encode('pto2-clean.png');
  const ix = 40, iy = 30, iw = 880, ih = 500;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const TOP = 8;    // top callout ly (label box above)
  const BOT = 560;  // bottom callout ly (label box below)
  const LL  = 162;  // left horizontal label lx
  const RL  = 798;  // right horizontal label lx
  write('winctrl-pto2.svg', {
    id: 'pto2', footer: 'WINCTRL PTO2 — carrier / flight controls', W: 960, H: 600,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // top row — vertical labels going up
      { id: 'gear-lt',    cx: px(.06), cy: py(.22), lx: px(.06), ly: TOP },
      { id: 'launch-bar', cx: px(.25), cy: py(.22), lx: px(.25), ly: TOP },
      { id: 'flap-auto',  cx: px(.34), cy: py(.22), lx: px(.34), ly: TOP },
      { id: 'jett-sel',   cx: px(.46), cy: py(.24), lx: px(.46), ly: TOP },
      { id: 'jett-sta',   cx: px(.62), cy: py(.22), lx: px(.62), ly: TOP },
      { id: 'hook',       cx: px(.87), cy: py(.22), lx: px(.87), ly: TOP },
      // mid-panel — left horizontal
      { id: 'hook-byp',   cx: px(.07), cy: py(.48), lx: LL, ly: 270 },
      { id: 'ldg-taxi',   cx: px(.27), cy: py(.38), lx: LL, ly: 294 },
      { id: 'anti-skid',  cx: px(.37), cy: py(.38), lx: LL, ly: 318 },
      // mid-panel — right horizontal
      { id: 'li-ind',     cx: px(.63), cy: py(.43), lx: RL, ly: 248 },
      { id: 'lo-ind',     cx: px(.63), cy: py(.54), lx: RL, ly: 272 },
      { id: 'ro-ind',     cx: px(.72), cy: py(.54), lx: RL, ly: 296 },
      { id: 'wing-fold',  cx: px(.84), cy: py(.50), lx: RL, ly: 320 },
      // bottom row — vertical labels going down
      { id: 'jett-btn',   cx: px(.47), cy: py(.38), lx: px(.47), ly: BOT },
      { id: 'park-brk',   cx: px(.53), cy: py(.59), lx: px(.53), ly: BOT },
      { id: 'camera',     cx: px(.24), cy: py(.58), lx: px(.24), ly: BOT },
      { id: 'nose-btn',   cx: px(.65), cy: py(.65), lx: px(.65), ly: BOT },
      { id: 'flaps',      cx: px(.67), cy: py(.88), lx: px(.67), ly: BOT },
      { id: 'spread',     cx: px(.92), cy: py(.87), lx: px(.92), ly: BOT },
    ],
  });
}

// ── winctrl-pto2-f16c ────────────────────────────────────────────────────────
// Same hardware; F-16C module binding context
{
  const img = encode('f16c-pto2-clean.png');
  const ix = 40, iy = 30, iw = 880, ih = 500;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const TOP = 8, BOT = 560, LL = 162, RL = 798;
  write('winctrl-pto2-f16c.svg', {
    id: 'pto2-f16c', footer: 'WINCTRL PTO2 — F-16C profile', W: 960, H: 600,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'gear-lt',    cx: px(.06), cy: py(.22), lx: px(.06), ly: TOP },
      { id: 'launch-bar', cx: px(.25), cy: py(.22), lx: px(.25), ly: TOP },
      { id: 'flap-auto',  cx: px(.34), cy: py(.22), lx: px(.34), ly: TOP },
      { id: 'jett-sel',   cx: px(.46), cy: py(.24), lx: px(.46), ly: TOP },
      { id: 'jett-sta',   cx: px(.62), cy: py(.22), lx: px(.62), ly: TOP },
      { id: 'hook',       cx: px(.87), cy: py(.22), lx: px(.87), ly: TOP },
      { id: 'hook-byp',   cx: px(.07), cy: py(.48), lx: LL, ly: 270 },
      { id: 'ldg-taxi',   cx: px(.27), cy: py(.38), lx: LL, ly: 294 },
      { id: 'anti-skid',  cx: px(.37), cy: py(.38), lx: LL, ly: 318 },
      { id: 'li-ind',     cx: px(.63), cy: py(.43), lx: RL, ly: 248 },
      { id: 'lo-ind',     cx: px(.63), cy: py(.54), lx: RL, ly: 272 },
      { id: 'ro-ind',     cx: px(.72), cy: py(.54), lx: RL, ly: 296 },
      { id: 'wing-fold',  cx: px(.84), cy: py(.50), lx: RL, ly: 320 },
      { id: 'jett-btn',   cx: px(.47), cy: py(.38), lx: px(.47), ly: BOT },
      { id: 'park-brk',   cx: px(.53), cy: py(.59), lx: px(.53), ly: BOT },
      { id: 'camera',     cx: px(.24), cy: py(.58), lx: px(.24), ly: BOT },
      { id: 'nose-btn',   cx: px(.65), cy: py(.65), lx: px(.65), ly: BOT },
      { id: 'flaps',      cx: px(.67), cy: py(.88), lx: px(.67), ly: BOT },
      { id: 'spread',     cx: px(.92), cy: py(.87), lx: px(.92), ly: BOT },
    ],
  });
}

// ── onyourtwelve-pdcp ────────────────────────────────────────────────────────
// Source: pdcp-photo.jpeg  portrait panel photo ~930 × 1180 px
// Canvas: 860 × 740, image: x=260 y=15 w=340 h=690
{
  const img = encode('pdcp-photo.jpeg');
  const ix = 260, iy = 15, iw = 340, ih = 690;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 215, RL = 640;
  write('onyourtwelve-pdcp.svg', {
    id: 'pdcp', footer: 'OnYourTwelve PDCP', W: 860, H: 740,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // left mode buttons — left labels, staggered
      { id: 'to',       cx: px(.17), cy: py(.22), lx: LL, ly: 160 },
      { id: 'cruise',   cx: px(.17), cy: py(.38), lx: LL, ly: 270 },
      { id: 'aa',       cx: px(.17), cy: py(.54), lx: LL, ly: 380 },
      { id: 'ag',       cx: px(.17), cy: py(.69), lx: LL, ly: 490 },
      { id: 'ldg',      cx: px(.17), cy: py(.84), lx: LL, ly: 590 },
      // centre column — right labels
      { id: 'hud-dec',  cx: px(.43), cy: py(.26), lx: RL, ly: 185 },
      { id: 'vdi-mode', cx: px(.43), cy: py(.47), lx: RL, ly: 325 },
      { id: 'hsd-mode', cx: px(.43), cy: py(.62), lx: RL, ly: 430 },
      { id: 'pwr-vdi',  cx: px(.43), cy: py(.80), lx: RL, ly: 555 },
      // right column — right labels, each 24 px apart from centre column
      { id: 'hud-awl',  cx: px(.72), cy: py(.26), lx: RL, ly: 209 },
      { id: 'vdi-awl',  cx: px(.72), cy: py(.47), lx: RL, ly: 349 },
      { id: 'hsd-ecm',  cx: px(.72), cy: py(.62), lx: RL, ly: 454 },
      { id: 'pwr-hud',  cx: px(.72), cy: py(.80), lx: RL, ly: 579 },
    ],
  });
}

// ── tm-mfd ───────────────────────────────────────────────────────────────────
// Source: mfd-clean.png  ~900 × 900 px (square)
// Canvas: 960 × 660, image: x=120 y=30 w=600 h=590
// OSBs on all 4 sides; top/bottom use vertical callouts.
{
  const img = encode('mfd-clean.png');
  const ix = 120, iy = 30, iw = 600, ih = 590;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 100, RL = 760;
  const TOP = 8, BOT = 640;
  write('tm-mfd.svg', {
    id: 'mfd', footer: 'TM MFD', W: 960, H: 660,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // top row OSBs — vertical up
      { id: 'osb-t1', cx: px(.14), cy: py(.09), lx: px(.14), ly: TOP },
      { id: 'osb-t2', cx: px(.26), cy: py(.09), lx: px(.26), ly: TOP },
      { id: 'osb-t3', cx: px(.38), cy: py(.09), lx: px(.38), ly: TOP },
      { id: 'osb-t4', cx: px(.62), cy: py(.09), lx: px(.62), ly: TOP },
      { id: 'osb-t5', cx: px(.74), cy: py(.09), lx: px(.74), ly: TOP },
      // right side OSBs — right labels
      { id: 'osb-r1', cx: px(.89), cy: py(.18), lx: RL, ly: 137 },
      { id: 'osb-r2', cx: px(.89), cy: py(.32), lx: RL, ly: 219 },
      { id: 'osb-r3', cx: px(.89), cy: py(.50), lx: RL, ly: 325 },
      { id: 'osb-r4', cx: px(.89), cy: py(.68), lx: RL, ly: 431 },
      { id: 'osb-r5', cx: px(.89), cy: py(.82), lx: RL, ly: 513 },
      // left side OSBs — left labels
      { id: 'osb-l1', cx: px(.10), cy: py(.18), lx: LL, ly: 137 },
      { id: 'osb-l2', cx: px(.10), cy: py(.32), lx: LL, ly: 219 },
      { id: 'osb-l3', cx: px(.10), cy: py(.50), lx: LL, ly: 325 },
      { id: 'osb-l4', cx: px(.10), cy: py(.68), lx: LL, ly: 431 },
      { id: 'osb-l5', cx: px(.10), cy: py(.82), lx: LL, ly: 513 },
      // bottom row OSBs — vertical down
      { id: 'osb-b1', cx: px(.14), cy: py(.91), lx: px(.14), ly: BOT },
      { id: 'osb-b2', cx: px(.26), cy: py(.91), lx: px(.26), ly: BOT },
      { id: 'osb-b3', cx: px(.38), cy: py(.91), lx: px(.38), ly: BOT },
      { id: 'osb-b4', cx: px(.62), cy: py(.91), lx: px(.62), ly: BOT },
      { id: 'osb-b5', cx: px(.74), cy: py(.91), lx: px(.74), ly: BOT },
    ],
  });
}

// ── tm-warthog-throttle ──────────────────────────────────────────────────────
// Source: base panel (portrait diagram) + handles (3/4-view diagram)
// Canvas: 960 × 620
// Base: x=90 y=10 w=370 h=600  Handles: x=510 y=20 w=380 h=500
{
  const base    = encode('warthog-throttle-base.png');
  const handles = encode('warthog-throttle-handles.png');
  const bix = 90,  biy = 10,  biw = 370, bih = 600;
  const hix = 510, hiy = 20,  hiw = 380, hih = 500;
  const bpx = (f) => Math.round(bix + f * biw);
  const bpy = (f) => Math.round(biy + f * bih);
  const hpx = (f) => Math.round(hix + f * hiw);
  const hpy = (f) => Math.round(hiy + f * hih);
  const BL = 50, BR = 480;   // base left / right label lx
  const HR = 920;             // handles right label lx
  write('tm-warthog-throttle.svg', {
    id: 'warthog-thr', footer: 'TM Warthog Throttle  (panel | handles)', W: 960, H: 620,
    images: [
      { href: base,    x: bix, y: biy, w: biw, h: bih },
      { href: handles, x: hix, y: hiy, w: hiw, h: hih },
    ],
    callouts: [
      // panel — left labels
      { id: 'friction',    cx: bpx(.15), cy: bpy(.06), lx: BL, ly: 36  },
      { id: 'flaps',       cx: bpx(.10), cy: bpy(.53), lx: BL, ly: 328 },
      { id: 'eac',         cx: bpx(.15), cy: bpy(.73), lx: BL, ly: 446 },
      { id: 'rdr-altm',    cx: bpx(.30), cy: bpy(.73), lx: BL, ly: 470 },
      // panel — right labels (between the two images)
      { id: 'fuel-flow-r', cx: bpx(.72), cy: bpy(.07), lx: BR, ly: 52  },
      { id: 'fuel-norm',   cx: bpx(.62), cy: bpy(.07), lx: BR, ly: 76  },
      { id: 'fuel-ovrd',   cx: bpx(.72), cy: bpy(.14), lx: BR, ly: 100 },
      { id: 'eng-ign-l',   cx: bpx(.55), cy: bpy(.28), lx: BR, ly: 178 },
      { id: 'eng-ign-r',   cx: bpx(.78), cy: bpy(.28), lx: BR, ly: 202 },
      { id: 'apu-start',   cx: bpx(.63), cy: bpy(.42), lx: BR, ly: 262 },
      { id: 'lg-warn',     cx: bpx(.65), cy: bpy(.57), lx: BR, ly: 352 },
      { id: 'ap-engage',   cx: bpx(.55), cy: bpy(.73), lx: BR, ly: 446 },
      { id: 'ap-alt-hdg',  cx: bpx(.72), cy: bpy(.73), lx: BR, ly: 470 },
      // handles — right labels
      { id: 'coolie-hat',  cx: hpx(.35), cy: hpy(.30), lx: HR, ly: 185 },
      { id: 'slew-ctrl',   cx: hpx(.50), cy: hpy(.38), lx: HR, ly: 222 },
      { id: 'btn1',        cx: hpx(.62), cy: hpy(.38), lx: HR, ly: 259 },
      { id: 'pinky',       cx: hpx(.85), cy: hpy(.62), lx: HR, ly: 340 },
      { id: 'hat',         cx: hpx(.12), cy: hpy(.72), lx: HR, ly: 414 },
    ],
  });
}

// ── f4u-logitech-throttle-quadrant ───────────────────────────────────────────
// Source: f4u-logitech-throttle-quadrant.png  3/4-view ~1200×900 landscape
// Canvas: 960 × 640, image: x=80 y=25 w=680 h=560
{
  const img = encode('f4u-logitech-throttle-quadrant.png');
  const ix = 80, iy = 25, iw = 680, ih = 560;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 50, RL = 800;
  const TOP = 8;
  write('f4u-logitech-throttle-quadrant.svg', {
    id: 'f4u-ltq', footer: 'F4U-1D — Logitech Throttle Quadrant', W: 960, H: 640,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // throttle levers — vertical up
      { id: 'thr1',     cx: px(.42), cy: py(.08), lx: px(.42), ly: TOP },
      { id: 'thr2',     cx: px(.50), cy: py(.08), lx: px(.50), ly: TOP },
      { id: 'thr3',     cx: px(.58), cy: py(.08), lx: px(.58), ly: TOP },
      // body buttons — left labels
      { id: 'btn-bl',   cx: px(.24), cy: py(.54), lx: LL, ly: 327 },
      { id: 'btn-tl',   cx: px(.24), cy: py(.44), lx: LL, ly: 271 },
      { id: 'btn-br',   cx: px(.32), cy: py(.54), lx: LL, ly: 351 },
      // toggle bank — right labels
      { id: 'tog-t1',   cx: px(.63), cy: py(.84), lx: RL, ly: 497 },
      { id: 'tog-t2',   cx: px(.71), cy: py(.84), lx: RL, ly: 521 },
      { id: 'tog-t3',   cx: px(.78), cy: py(.84), lx: RL, ly: 545 },
      { id: 'tog-t4',   cx: px(.86), cy: py(.84), lx: RL, ly: 569 },
    ],
  });
}

// ── logitech-throttle-quadrant ────────────────────────────────────────────────
// Same hardware; generic module context
{
  const img = encode('f4u-logitech-throttle-quadrant.png');
  const ix = 80, iy = 25, iw = 680, ih = 560;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 50, RL = 800, TOP = 8;
  write('logitech-throttle-quadrant.svg', {
    id: 'ltq', footer: 'Logitech Throttle Quadrant', W: 960, H: 640,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'thr1',   cx: px(.42), cy: py(.08), lx: px(.42), ly: TOP },
      { id: 'thr2',   cx: px(.50), cy: py(.08), lx: px(.50), ly: TOP },
      { id: 'thr3',   cx: px(.58), cy: py(.08), lx: px(.58), ly: TOP },
      { id: 'btn-bl', cx: px(.24), cy: py(.54), lx: LL, ly: 327 },
      { id: 'btn-tl', cx: px(.24), cy: py(.44), lx: LL, ly: 271 },
      { id: 'btn-br', cx: px(.32), cy: py(.54), lx: LL, ly: 351 },
      { id: 'tog-t1', cx: px(.63), cy: py(.84), lx: RL, ly: 497 },
      { id: 'tog-t2', cx: px(.71), cy: py(.84), lx: RL, ly: 521 },
      { id: 'tog-t3', cx: px(.78), cy: py(.84), lx: RL, ly: 545 },
      { id: 'tog-t4', cx: px(.86), cy: py(.84), lx: RL, ly: 569 },
    ],
  });
}

// ── grip-f16c ────────────────────────────────────────────────────────────────
// Warthog grip, F-16C binding context — front view only
{
  const img = encode('f16c-warthog-grip-front.png');
  const ix = 245, iy = 15, iw = 220, ih = 530;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  const LL = 210, RL = 510;
  write('grip-f16c.svg', {
    id: 'grip-f16c', footer: 'F-16C Grip (Warthog front)', W: 700, H: 580,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'btn-red',    cx: px(.28), cy: py(.07), lx: LL, ly: 52  },
      { id: 'hat',        cx: px(.55), cy: py(.12), lx: RL, ly: 78  },
      { id: 'dcs-hat',    cx: px(.60), cy: py(.25), lx: RL, ly: 148 },
      { id: 'trim-wheel', cx: px(.13), cy: py(.22), lx: LL, ly: 130 },
      { id: 'boat-sw',    cx: px(.70), cy: py(.36), lx: RL, ly: 207 },
      { id: 'china-hat',  cx: px(.68), cy: py(.44), lx: RL, ly: 251 },
      { id: 'paddle',     cx: px(.07), cy: py(.40), lx: LL, ly: 230 },
      { id: 'pinky',      cx: px(.42), cy: py(.48), lx: LL, ly: 275 },
      { id: 'stage1',     cx: px(.73), cy: py(.54), lx: RL, ly: 295 },
      { id: 'stage2',     cx: px(.73), cy: py(.62), lx: RL, ly: 340 },
    ],
  });
}

// ── Devices without source images ────────────────────────────────────────────
write('moza-ab9.svg', {
  id: 'moza-ab9', footer: 'MOZA AB9 FFB Base', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});
write('ava-base-f16c.svg', {
  id: 'ava-base-f16c', footer: 'VKB AVA Base + F-16C Grip', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});
write('ava-base-f18c.svg', {
  id: 'ava-base-f18c', footer: 'VKB AVA Base + F-18C Grip', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});
write('grip-f18c.svg', {
  id: 'grip-f18c', footer: 'F-18C Grip', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});
write('tm-tpr.svg', {
  id: 'tm-tpr', footer: 'TM T-Pendular Rudder (TPR)', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});
write('winctrl-icp.svg', {
  id: 'winctrl-icp', footer: 'WINCTRL ViperAce ICP', W: 640, H: 440, noImg: true,
  images: [], callouts: [],
});

console.log('\nDone.');
