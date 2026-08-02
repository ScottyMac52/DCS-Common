/**
 * Generates shared hardware SVG templates.
 *
 * Each SVG embeds the source image as a base64 data URI so it renders in all
 * contexts (browser, GitHub, embedded HTML).  Callout lines point to actual
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
const ACCENT  = '#00bfff';
const BG      = '#0f172a';
const CARD    = '#1e293b';
const TXT     = '#f1f5f9';
const FOOTER  = '#475569';
const LW      = 160;   // label box width
const LH      = 22;    // label box height

// ── Helpers ──────────────────────────────────────────────────────────────────
function encode(file) {
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(join(srcDir, file)).toString('base64')}`;
}

/** Build one callout: dot on control → dashed line → blank label box. */
function callout(id, cx, cy, lx, ly) {
  const right = lx > cx;
  const bx = right ? lx : lx - LW;
  const by = ly - Math.floor(LH / 2);
  return [
    `  <!-- callout:${id} -->`,
    `  <line x1="${cx}" y1="${cy}" x2="${lx}" y2="${ly}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.75"/>`,
    `  <circle cx="${cx}" cy="${cy}" r="5" fill="${ACCENT}" stroke="${BG}" stroke-width="1.5"/>`,
    `  <rect x="${bx}" y="${by}" width="${LW}" height="${LH}" rx="4" fill="${CARD}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    `  <text id="lbl-${id}" x="${bx + Math.floor(LW / 2)}" y="${by + 15}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="${TXT}"></text>`,
  ].join('\n');
}

/**
 * Render a complete SVG.
 * @param {{ id, footer, W, H, images, callouts, noImg? }} spec
 */
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
// Coordinate notes
//   cx, cy = pixel on the SVG canvas where the control sits (inside the image)
//   lx, ly = endpoint of the dashed line (where the label box anchors)
//   lx < cx → label box is to the LEFT  (box occupies lx-LW .. lx)
//   lx > cx → label box is to the RIGHT (box occupies lx .. lx+LW)
// ═══════════════════════════════════════════════════════════════════════════

// ── vkb-f14-gunfighter ───────────────────────────────────────────────────────
// Source: vkb-grip-clean.png  ~530 × 730 px (portrait)
// Canvas: 700 × 760, image: x=200 y=15 w=300 h=690
{
  const img = encode('vkb-grip-clean.png');
  const ix = 200, iy = 15, iw = 300, ih = 690;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('vkb-f14-gunfighter.svg', {
    id: 'vkb', footer: 'VKB F-14 Gunfighter Grip', W: 700, H: 760,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'hat',     cx: px(.47), cy: py(.03), lx: 545, ly: py(.03) },
      { id: 'btn-red', cx: px(.82), cy: py(.06), lx: 545, ly: py(.06) + 30 },
      { id: 'sw1',     cx: px(.10), cy: py(.17), lx: 155, ly: py(.17) },
      { id: 'sw2',     cx: px(.10), cy: py(.23), lx: 155, ly: py(.23) },
      { id: 'sw3',     cx: px(.10), cy: py(.31), lx: 155, ly: py(.31) },
      { id: 'pinky',   cx: px(.13), cy: py(.59), lx: 155, ly: py(.59) },
      { id: 'trigger', cx: px(.72), cy: py(.64), lx: 545, ly: py(.64) },
    ],
  });
}

// ── f4u-vkb-grip ─────────────────────────────────────────────────────────────
// Same hardware as above; different DCS module mapping
{
  const img = encode('f4u-vkb-grip-clean.png');
  const ix = 200, iy = 15, iw = 300, ih = 690;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('f4u-vkb-grip.svg', {
    id: 'f4u-vkb', footer: 'F4U-1D — VKB F-14 Gunfighter Grip', W: 700, H: 760,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'hat',     cx: px(.47), cy: py(.03), lx: 545, ly: py(.03) },
      { id: 'btn-red', cx: px(.82), cy: py(.06), lx: 545, ly: py(.06) + 30 },
      { id: 'sw1',     cx: px(.10), cy: py(.17), lx: 155, ly: py(.17) },
      { id: 'sw2',     cx: px(.10), cy: py(.23), lx: 155, ly: py(.23) },
      { id: 'sw3',     cx: px(.10), cy: py(.31), lx: 155, ly: py(.31) },
      { id: 'pinky',   cx: px(.13), cy: py(.59), lx: 155, ly: py(.59) },
      { id: 'trigger', cx: px(.72), cy: py(.64), lx: 545, ly: py(.64) },
    ],
  });
}

// ── warthog-grip-f16c ────────────────────────────────────────────────────────
// Source: f16c-warthog-grip-front.png (~530×680 portrait) and rear (~530×680)
// Canvas: 960 × 560, front: x=60 y=20 w=200 h=500, rear: x=310 y=20 w=160 h=420
{
  const front = encode('f16c-warthog-grip-front.png');
  const rear  = encode('f16c-warthog-grip-rear.png');
  const fix = 60,  fiy = 20, fiw = 200, fih = 500;
  const rix = 310, riy = 20, riw = 160, rih = 420;
  const fpx = (f) => Math.round(fix + f * fiw);
  const fpy = (f) => Math.round(fiy + f * fih);
  const rpx = (f) => Math.round(rix + f * riw);
  const rpy = (f) => Math.round(riy + f * rih);
  write('warthog-grip-f16c.svg', {
    id: 'wg-f16c', footer: 'Warthog Grip — F-16C profile  (front | rear)', W: 960, H: 560,
    images: [
      { href: front, x: fix, y: fiy, w: fiw, h: fih },
      { href: rear,  x: rix, y: riy, w: riw, h: rih },
    ],
    callouts: [
      // front
      { id: 'btn-red',   cx: fpx(.28), cy: fpy(.07), lx: 20,  ly: fpy(.07) },
      { id: 'hat',       cx: fpx(.55), cy: fpy(.12), lx: 20,  ly: fpy(.12) + 34 },
      { id: 'trim-wheel',cx: fpx(.13), cy: fpy(.22), lx: 20,  ly: fpy(.22) + 34 },
      { id: 'pinky',     cx: fpx(.42), cy: fpy(.48), lx: 20,  ly: fpy(.48) },
      { id: 'trigger',   cx: fpx(.72), cy: fpy(.54), lx: 280, ly: fpy(.54) },
      // rear
      { id: 'rear-sw1',  cx: rpx(.50), cy: rpy(.20), lx: 800, ly: rpy(.20) },
      { id: 'rear-sw2',  cx: rpx(.50), cy: rpy(.35), lx: 800, ly: rpy(.35) },
    ],
  });
}

// ── winctrl-icp-f16c ─────────────────────────────────────────────────────────
// Source: f16c-icp-clean.png  ~975 × 1000 px (nearly square)
// Canvas: 960 × 640, image: x=200 y=10 w=560 h=575
{
  const img = encode('f16c-icp-clean.png');
  const ix = 200, iy = 10, iw = 560, ih = 575;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('winctrl-icp-f16c.svg', {
    id: 'icp-f16c', footer: 'WINCTRL ICP — F-16C profile', W: 960, H: 640,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'com1',   cx: px(.27), cy: py(.44), lx: 155, ly: py(.44) },
      { id: 'com2',   cx: px(.36), cy: py(.44), lx: 155, ly: py(.44) + 26 },
      { id: 'iff',    cx: px(.47), cy: py(.44), lx: 155, ly: py(.44) + 52 },
      { id: 'list',   cx: px(.57), cy: py(.44), lx: 800, ly: py(.44) },
      { id: 'a-a',    cx: px(.65), cy: py(.44), lx: 800, ly: py(.44) + 26 },
      { id: 'a-g',    cx: px(.73), cy: py(.44), lx: 800, ly: py(.44) + 52 },
      { id: 'kp-1',   cx: px(.27), cy: py(.56), lx: 155, ly: py(.56) },
      { id: 'kp-5',   cx: px(.47), cy: py(.67), lx: 155, ly: py(.67) },
      { id: 'kp-entr',cx: px(.63), cy: py(.62), lx: 800, ly: py(.62) },
      { id: 'rtn',    cx: px(.39), cy: py(.87), lx: 155, ly: py(.87) },
      { id: 'seq',    cx: px(.46), cy: py(.87), lx: 800, ly: py(.87) },
    ],
  });
}

// ── winctrl-pto2 ─────────────────────────────────────────────────────────────
// Source: pto2-clean.png  landscape carrier/flight-controls panel
// Canvas: 960 × 600, image: x=40 y=30 w=880 h=500
{
  const img = encode('pto2-clean.png');
  const ix = 40, iy = 30, iw = 880, ih = 500;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('winctrl-pto2.svg', {
    id: 'pto2', footer: 'WINCTRL PTO2 — carrier / flight controls', W: 960, H: 600,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'gear-lt',       cx: px(.07), cy: py(.24), lx: px(.07) - 10, ly: py(.24) - 60 },
      { id: 'launch-bar',    cx: px(.25), cy: py(.22), lx: px(.25),       ly: 10 },
      { id: 'flap-auto',     cx: px(.36), cy: py(.22), lx: px(.36) + 20,  ly: 10 },
      { id: 'jett-sel',      cx: px(.55), cy: py(.22), lx: px(.55),       ly: 10 },
      { id: 'hook',          cx: px(.87), cy: py(.22), lx: px(.87),       ly: 10 },
      { id: 'jett-btn',      cx: px(.47), cy: py(.38), lx: px(.47),       ly: py(.38) + 100 },
      { id: 'ldg-taxi',      cx: px(.29), cy: py(.40), lx: px(.29) - 20,  ly: py(.40) + 90 },
      { id: 'anti-skid',     cx: px(.37), cy: py(.40), lx: px(.37) + 20,  ly: py(.40) + 90 },
      { id: 'park-brk',      cx: px(.53), cy: py(.46), lx: px(.53),       ly: py(.46) + 100 },
      { id: 'wing-fold',     cx: px(.87), cy: py(.50), lx: px(.87),       ly: py(.50) + 80 },
      { id: 'flaps',         cx: px(.72), cy: py(.84), lx: px(.72),       ly: py(.84) + 50 },
    ],
  });
}

// ── winctrl-pto2-f16c ────────────────────────────────────────────────────────
// Source: f16c-pto2-clean.png  (same panel, F-16C profile)
{
  const img = encode('f16c-pto2-clean.png');
  const ix = 40, iy = 30, iw = 880, ih = 500;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('winctrl-pto2-f16c.svg', {
    id: 'pto2-f16c', footer: 'WINCTRL PTO2 — F-16C profile', W: 960, H: 600,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'gear-lt',       cx: px(.07), cy: py(.24), lx: px(.07) - 10, ly: py(.24) - 60 },
      { id: 'launch-bar',    cx: px(.25), cy: py(.22), lx: px(.25),       ly: 10 },
      { id: 'flap-auto',     cx: px(.36), cy: py(.22), lx: px(.36) + 20,  ly: 10 },
      { id: 'jett-sel',      cx: px(.55), cy: py(.22), lx: px(.55),       ly: 10 },
      { id: 'hook',          cx: px(.87), cy: py(.22), lx: px(.87),       ly: 10 },
      { id: 'jett-btn',      cx: px(.47), cy: py(.38), lx: px(.47),       ly: py(.38) + 100 },
      { id: 'ldg-taxi',      cx: px(.29), cy: py(.40), lx: px(.29) - 20,  ly: py(.40) + 90 },
      { id: 'anti-skid',     cx: px(.37), cy: py(.40), lx: px(.37) + 20,  ly: py(.40) + 90 },
      { id: 'park-brk',      cx: px(.53), cy: py(.46), lx: px(.53),       ly: py(.46) + 100 },
      { id: 'wing-fold',     cx: px(.87), cy: py(.50), lx: px(.87),       ly: py(.50) + 80 },
      { id: 'flaps',         cx: px(.72), cy: py(.84), lx: px(.72),       ly: py(.84) + 50 },
    ],
  });
}

// ── onyourtwelve-pdcp ────────────────────────────────────────────────────────
// Source: pdcp-photo.jpeg  portrait panel photo ~930 × 1180 px
// Canvas: 840 × 700, image: x=250 y=15 w=340 h=650
{
  const img = encode('pdcp-photo.jpeg');
  const ix = 250, iy = 15, iw = 340, ih = 650;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('onyourtwelve-pdcp.svg', {
    id: 'pdcp', footer: 'OnYourTwelve PDCP', W: 840, H: 700,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'to',        cx: px(.17), cy: py(.22), lx: 210, ly: py(.22) },
      { id: 'cruise',    cx: px(.17), cy: py(.38), lx: 210, ly: py(.38) },
      { id: 'aa',        cx: px(.17), cy: py(.54), lx: 210, ly: py(.54) },
      { id: 'ag',        cx: px(.17), cy: py(.69), lx: 210, ly: py(.69) },
      { id: 'ldg',       cx: px(.17), cy: py(.84), lx: 210, ly: py(.84) },
      { id: 'hud-dec',   cx: px(.43), cy: py(.26), lx: 630, ly: py(.26) },
      { id: 'vdi-mode',  cx: px(.43), cy: py(.47), lx: 630, ly: py(.47) },
      { id: 'hsd-mode',  cx: px(.43), cy: py(.62), lx: 630, ly: py(.62) },
      { id: 'hud-awl',   cx: px(.72), cy: py(.26), lx: 630, ly: py(.26) + 26 },
      { id: 'vdi-awl',   cx: px(.72), cy: py(.47), lx: 630, ly: py(.47) + 26 },
      { id: 'pwr-vdi',   cx: px(.18), cy: py(.80), lx: 210, ly: py(.80) + 26 },
      { id: 'pwr-hud',   cx: px(.43), cy: py(.80), lx: 630, ly: py(.80) + 26 },
    ],
  });
}

// ── tm-mfd ───────────────────────────────────────────────────────────────────
// Source: mfd-clean.png  ~900 × 900 px (square)
// Canvas: 960 × 640, image: x=120 y=20 w=600 h=580
{
  const img = encode('mfd-clean.png');
  const ix = 120, iy = 20, iw = 600, ih = 580;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('tm-mfd.svg', {
    id: 'mfd', footer: 'TM MFD', W: 960, H: 640,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      // top row OSBs T1–T5
      { id: 'osb-t1', cx: px(.14), cy: py(.10), lx: px(.14), ly: 10 },
      { id: 'osb-t2', cx: px(.26), cy: py(.10), lx: px(.26), ly: 10 },
      { id: 'osb-t3', cx: px(.38), cy: py(.10), lx: px(.38), ly: 10 },
      { id: 'osb-t4', cx: px(.62), cy: py(.10), lx: px(.62), ly: 10 },
      { id: 'osb-t5', cx: px(.74), cy: py(.10), lx: px(.74), ly: 10 },
      // right-side OSBs R1–R5
      { id: 'osb-r1', cx: px(.89), cy: py(.20), lx: 800, ly: py(.20) },
      { id: 'osb-r2', cx: px(.89), cy: py(.35), lx: 800, ly: py(.35) },
      { id: 'osb-r3', cx: px(.89), cy: py(.50), lx: 800, ly: py(.50) },
      { id: 'osb-r4', cx: px(.89), cy: py(.65), lx: 800, ly: py(.65) },
      { id: 'osb-r5', cx: px(.89), cy: py(.80), lx: 800, ly: py(.80) },
    ],
  });
}

// ── tm-warthog-throttle ──────────────────────────────────────────────────────
// Source: warthog-throttle-base.png (panel), warthog-throttle-handles.png (handles)
// Canvas: 960 × 600
{
  const base    = encode('warthog-throttle-base.png');
  const handles = encode('warthog-throttle-handles.png');
  // Base panel is a cropped/angled shot, roughly 600×800 portrait
  const ix = 200, iy = 20, iw = 380, ih = 540;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('tm-warthog-throttle.svg', {
    id: 'warthog-thr', footer: 'TM Warthog Throttle', W: 960, H: 600,
    images: [
      { href: base,    x: ix,  y: iy,  w: iw, h: ih },
      { href: handles, x: 610, y: 200, w: 280, h: 160 },
    ],
    callouts: [
      { id: 'friction', cx: px(.15), cy: py(.06), lx: 155, ly: py(.06) },
      { id: 'fuel-eng', cx: px(.62), cy: py(.08), lx: 625, ly: py(.08) },
      { id: 'eng-ign',  cx: px(.55), cy: py(.30), lx: 625, ly: py(.30) },
      { id: 'apu',      cx: px(.63), cy: py(.38), lx: 625, ly: py(.38) },
      { id: 'eac',      cx: px(.15), cy: py(.66), lx: 155, ly: py(.66) },
      { id: 'rdr-altm', cx: px(.30), cy: py(.66), lx: 155, ly: py(.66) + 26 },
      { id: 'ap-engage',cx: px(.55), cy: py(.73), lx: 625, ly: py(.73) },
    ],
  });
}

// ── f4u-logitech-throttle-quadrant ───────────────────────────────────────────
// Source: f4u-logitech-throttle-quadrant.png  3/4-view ~1200×900 landscape
// Canvas: 960 × 620, image: x=80 y=20 w=680 h=540
{
  const img = encode('f4u-logitech-throttle-quadrant.png');
  const ix = 80, iy = 20, iw = 680, ih = 540;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('f4u-logitech-throttle-quadrant.svg', {
    id: 'f4u-ltq', footer: 'F4U-1D — Logitech Throttle Quadrant', W: 960, H: 620,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'thr1',   cx: px(.42), cy: py(.08), lx: 155, ly: py(.08) },
      { id: 'thr2',   cx: px(.50), cy: py(.08), lx: 155, ly: py(.08) + 26 },
      { id: 'thr3',   cx: px(.58), cy: py(.08), lx: 155, ly: py(.08) + 52 },
      { id: 'tog-t1', cx: px(.63), cy: py(.84), lx: 800, ly: py(.84) },
      { id: 'tog-t2', cx: px(.71), cy: py(.84), lx: 800, ly: py(.84) + 26 },
      { id: 'tog-t3', cx: px(.78), cy: py(.84), lx: 800, ly: py(.84) + 52 },
    ],
  });
}

// ── logitech-throttle-quadrant ────────────────────────────────────────────────
// Re-use the same source image; different module mapping
{
  const img = encode('f4u-logitech-throttle-quadrant.png');
  const ix = 80, iy = 20, iw = 680, ih = 540;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('logitech-throttle-quadrant.svg', {
    id: 'ltq', footer: 'Logitech Throttle Quadrant', W: 960, H: 620,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'thr1',   cx: px(.42), cy: py(.08), lx: 155, ly: py(.08) },
      { id: 'thr2',   cx: px(.50), cy: py(.08), lx: 155, ly: py(.08) + 26 },
      { id: 'thr3',   cx: px(.58), cy: py(.08), lx: 155, ly: py(.08) + 52 },
      { id: 'tog-t1', cx: px(.63), cy: py(.84), lx: 800, ly: py(.84) },
      { id: 'tog-t2', cx: px(.71), cy: py(.84), lx: 800, ly: py(.84) + 26 },
      { id: 'tog-t3', cx: px(.78), cy: py(.84), lx: 800, ly: py(.84) + 52 },
    ],
  });
}

// ── grip-f16c ────────────────────────────────────────────────────────────────
// Warthog grip used in an F-16C context — use same front image
{
  const img = encode('f16c-warthog-grip-front.png');
  const ix = 250, iy = 20, iw = 220, ih = 500;
  const px = (f) => Math.round(ix + f * iw);
  const py = (f) => Math.round(iy + f * ih);
  write('grip-f16c.svg', {
    id: 'grip-f16c', footer: 'F-16C Grip', W: 700, H: 560,
    images: [{ href: img, x: ix, y: iy, w: iw, h: ih }],
    callouts: [
      { id: 'btn-red',    cx: px(.28), cy: py(.07), lx: 210, ly: py(.07) },
      { id: 'hat',        cx: px(.55), cy: py(.12), lx: 510, ly: py(.12) },
      { id: 'trim-wheel', cx: px(.13), cy: py(.22), lx: 210, ly: py(.22) },
      { id: 'pinky',      cx: px(.42), cy: py(.48), lx: 210, ly: py(.48) },
      { id: 'trigger',    cx: px(.72), cy: py(.54), lx: 510, ly: py(.54) },
    ],
  });
}

// ── Devices without source images ────────────────────────────────────────────
// These need real source images added to assets/shared/hardware/source/

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
