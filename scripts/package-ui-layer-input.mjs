#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUID_SUFFIX = /\s*\{[0-9A-Fa-f-]{36}\}\s*$/u;

export function physicalDeviceName(filename) {
  return basename(filename)
    .replace(/\.diff\.lua$/iu, '')
    .replace(GUID_SUFFIX, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index;
  }
  throw new Error('Unbalanced modifiers.lua table.');
}

export function tailorModifiers(source, activePhysicalDevices) {
  const active = new Set([...activePhysicalDevices].map((value) => String(value).trim().replace(/\s+/gu, ' ').toLocaleLowerCase()));
  const headerEnd = source.indexOf('{') + 1;
  const returnIndex = source.lastIndexOf('return modifiers');
  if (headerEnd <= 0 || returnIndex < 0) throw new Error('Unsupported UI Layer modifiers.lua format.');
  const tableClose = source.lastIndexOf('}', returnIndex);
  const body = source.slice(headerEnd, tableClose);
  const entries = [];
  const pattern = /\["((?:\\.|[^"])*)"\]\s*=\s*\{/g;
  for (let match; (match = pattern.exec(body));) {
    const open = body.indexOf('{', match.index);
    const close = matchingBrace(body, open);
    const block = body.slice(match.index, close + 1);
    const device = block.match(/\["device"\]\s*=\s*"((?:\\.|[^"])*)"/)?.[1] ?? '';
    const normalized = device.replace(GUID_SUFFIX, '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
    if (normalized === 'keyboard' || active.has(normalized)) entries.push(block);
    pattern.lastIndex = close + 1;
  }
  return `local modifiers = {\n${entries.map((entry) => `\t${entry.replace(/\n/g, '\n\t')},`).join('\n')}\n}\nreturn modifiers\n`;
}

export function packageUiLayerInput({ commonRoot, consumerJoystickDir, destination }) {
  const sourceRoot = join(commonRoot, 'assets', 'shared', 'ui-layer', 'input', 'UiLayer');
  const sourceJoystick = join(sourceRoot, 'joystick');
  const destinationJoystick = join(destination, 'joystick');
  mkdirSync(destinationJoystick, { recursive: true });

  const consumerProfiles = readdirSync(consumerJoystickDir).filter((name) => name.endsWith('.diff.lua'));
  const activePhysicalDevices = new Set(consumerProfiles.map(physicalDeviceName));
  const copiedProfiles = [];
  for (const filename of readdirSync(sourceJoystick).filter((name) => name.endsWith('.diff.lua'))) {
    if (!activePhysicalDevices.has(physicalDeviceName(filename))) continue;
    copyFileSync(join(sourceJoystick, filename), join(destinationJoystick, filename));
    copiedProfiles.push(filename);
  }

  const modifiers = readFileSync(join(sourceRoot, 'modifiers.lua'), 'utf8');
  writeFileSync(join(destination, 'modifiers.lua'), tailorModifiers(modifiers, activePhysicalDevices), 'utf8');
  return { activePhysicalDevices: [...activePhysicalDevices].sort(), copiedProfiles: copiedProfiles.sort() };
}

function main(argv = process.argv.slice(2)) {
  const [commonRoot, consumerJoystickDir, destination] = argv;
  if (!commonRoot || !consumerJoystickDir || !destination) {
    console.error('Usage: node package-ui-layer-input.mjs <common-root> <consumer-joystick-dir> <destination>');
    return 1;
  }
  const result = packageUiLayerInput({
    commonRoot: resolve(commonRoot),
    consumerJoystickDir: resolve(consumerJoystickDir),
    destination: resolve(destination),
  });
  console.log(`Packaged ${result.copiedProfiles.length} UI Layer profile(s) for: ${result.activePhysicalDevices.join(', ') || 'no joystick devices'}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
