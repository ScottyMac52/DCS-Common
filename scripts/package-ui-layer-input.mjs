#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';

const GUID_SUFFIX = /\s*\{[0-9A-Fa-f-]{36}\}\s*$/u;

export function physicalDeviceName(filename) {
  return basename(filename).replace(/\.diff\.lua$/iu, '').replace(GUID_SUFFIX, '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
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
  throw new Error('Unbalanced Lua table braces.');
}

function topLevelNumericEntries(body) {
  const entries = [];
  const pattern = /\[(\d+)\]\s*=\s*\{/g;
  for (let match; (match = pattern.exec(body));) {
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (const char of body.slice(0, match.index)) {
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    if (depth !== 0) continue;
    const open = body.indexOf('{', match.index);
    const close = matchingBrace(body, open);
    const lineStart = body.lastIndexOf('\n', match.index) + 1;
    entries.push({ source: body.slice(lineStart, close + 1) });
    pattern.lastIndex = close + 1;
  }
  return entries;
}

function modifierNames(block) {
  const marker = block.indexOf('["reformers"]');
  if (marker < 0) return [];
  const open = block.indexOf('{', marker);
  const close = matchingBrace(block, open);
  return [...block.slice(open + 1, close).matchAll(/\[\d+\]\s*=\s*"((?:\\.|[^"])*)"/g)].map((match) => match[1]);
}

function tailorInputLists(source, availableModifiers) {
  const replacements = [];
  const pattern = /\["(added|removed)"\]\s*=\s*\{/g;
  for (let match; (match = pattern.exec(source));) {
    const open = source.indexOf('{', match.index);
    const close = matchingBrace(source, open);
    const entries = topLevelNumericEntries(source.slice(open + 1, close));
    const kept = entries.filter((entry) => modifierNames(entry.source).every((name) => availableModifiers.has(name)));
    if (kept.length !== entries.length) {
      const closeLineStart = source.lastIndexOf('\n', close) + 1;
      const closeIndent = source.slice(closeLineStart, close).match(/^\s*/u)?.[0] ?? '';
      const rendered = kept.length === 0
        ? '{}'
        : `{\n${kept.map((entry, index) => `${entry.source.replace(/\[\d+\](\s*=)/u, `[${index + 1}]$1`)},`).join('\n')}\n${closeIndent}}`;
      replacements.push({ start: open, end: close + 1, rendered });
    }
    pattern.lastIndex = close + 1;
  }
  let output = source;
  for (const replacement of replacements.reverse()) output = output.slice(0, replacement.start) + replacement.rendered + output.slice(replacement.end);
  return output;
}

export function tailorDiffLua(source, availableModifiers, { filename = 'profile.diff.lua' } = {}) {
  const tailored = tailorInputLists(source, availableModifiers);
  const parsed = parseDcsDiffLua(tailored, { filename });
  for (const binding of parsed.bindings) {
    for (const input of [...binding.added, ...binding.removed]) {
      for (const modifier of input.reformers) {
        if (!availableModifiers.has(modifier)) throw new Error(`${filename}: ${binding.command} references unavailable modifier ${modifier}`);
      }
    }
  }
  return tailored;
}

export function hasEffectiveAdditions(source, { filename = 'profile.diff.lua' } = {}) {
  return parseDcsDiffLua(source, { filename }).bindings.some((binding) => binding.added.length > 0);
}

export function tailorModifiers(source, activePhysicalDevices, allowedDeviceModifiers = null) {
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
    const modifierName = match[1];
    if (normalized === 'keyboard' || (active.has(normalized) && (!allowedDeviceModifiers || allowedDeviceModifiers.has(modifierName)))) entries.push(block);
    pattern.lastIndex = close + 1;
  }
  return `local modifiers = {\n${entries.map((entry) => `\t${entry.replace(/\n/g, '\n\t')},`).join('\n')}\n}\nreturn modifiers\n`;
}

function findConfig(consumerJoystickDir) {
  let current = resolve(consumerJoystickDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'config', 'kneeboard.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate config/kneeboard.json above ${consumerJoystickDir}`);
}

function profileReferences(config) {
  const referenced = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.profile === 'string') referenced.add(value.profile);
    for (const child of Object.values(value)) visit(child);
  };
  visit(config.pages ?? []);
  return referenced;
}

function configuredProfiles(config) {
  const references = profileReferences(config);
  if (references.size === 0) throw new Error('kneeboard.json does not reference any configured profiles from its pages.');
  const filenames = new Set();
  const profileIdsByFilename = new Map();
  for (const profileId of references) {
    const profilePath = config.profiles?.[profileId];
    if (!profilePath) throw new Error(`kneeboard.json references unknown profile: ${profileId}`);
    const filename = String(profilePath).replace(/\\/g, '/').split('/').at(-1);
    filenames.add(filename);
    if (!profileIdsByFilename.has(filename)) profileIdsByFilename.set(filename, []);
    profileIdsByFilename.get(filename).push(profileId);
  }
  return { filenames, profileIdsByFilename };
}

function configuredDeviceIds(config) {
  return new Set((config.pages ?? []).map((page) => page?.deviceId).filter((value) => typeof value === 'string'));
}

function selectedUiLayerModifiers(commonRoot, config) {
  const overlayPath = join(commonRoot, 'assets', 'shared', 'ui-layer', 'hardware-overlays.json');
  const overlays = JSON.parse(readFileSync(overlayPath, 'utf8'));
  const selections = overlays.modifierSelections ?? {};
  return new Set([...configuredDeviceIds(config)].map((deviceId) => selections[deviceId]).filter(Boolean));
}

function retainedNoOpProfiles(config) {
  return new Set((config.packaging?.retainNoOpProfiles ?? []).map((value) => String(value).toLocaleLowerCase()));
}

function shouldRetainNoOp(filename, profileIds, retain) {
  return [filename, filename.replace(/\.diff\.lua$/iu, ''), ...profileIds]
    .map((value) => value.toLocaleLowerCase()).some((value) => retain.has(value));
}

function findModuleDestinationJoystick(destination) {
  const inputRoot = dirname(destination);
  if (!existsSync(inputRoot)) return null;
  const candidates = readdirSync(inputRoot).filter((name) => name !== basename(destination))
    .map((name) => join(inputRoot, name, 'joystick')).filter((path) => existsSync(path) && statSync(path).isDirectory());
  return candidates.length === 1 ? candidates[0] : null;
}

export function packageUiLayerInput({ commonRoot, consumerJoystickDir, destination, configPath, moduleDestinationJoystick }) {
  const resolvedConfigPath = configPath ? resolve(configPath) : findConfig(consumerJoystickDir);
  const config = JSON.parse(readFileSync(resolvedConfigPath, 'utf8'));
  const { filenames: configuredFilenames, profileIdsByFilename } = configuredProfiles(config);
  const retainNoOp = retainedNoOpProfiles(config);
  const consumerProfiles = readdirSync(consumerJoystickDir).filter((name) => name.endsWith('.diff.lua'));
  const activeProfiles = [];
  const skippedProfiles = [];
  for (const filename of consumerProfiles) {
    if (!configuredFilenames.has(filename)) {
      skippedProfiles.push({ filename, reason: 'not selected by config/kneeboard.json' });
      continue;
    }
    const source = readFileSync(join(consumerJoystickDir, filename), 'utf8');
    const retained = shouldRetainNoOp(filename, profileIdsByFilename.get(filename) ?? [], retainNoOp);
    if (!hasEffectiveAdditions(source, { filename }) && !retained) {
      skippedProfiles.push({ filename, reason: 'no effective key or axis additions' });
      continue;
    }
    activeProfiles.push(filename);
  }
  const missing = [...configuredFilenames].filter((filename) => !consumerProfiles.includes(filename));
  if (missing.length) throw new Error(`Configured profile file(s) not found: ${missing.join(', ')}`);

  const stagedJoystick = moduleDestinationJoystick ?? findModuleDestinationJoystick(destination);
  if (stagedJoystick) {
    const active = new Set(activeProfiles);
    for (const filename of readdirSync(stagedJoystick).filter((name) => name.endsWith('.diff.lua'))) {
      if (!active.has(filename)) unlinkSync(join(stagedJoystick, filename));
    }
  }

  const activePhysicalDevices = new Set(activeProfiles.map(physicalDeviceName));
  const sourceRoot = join(commonRoot, 'assets', 'shared', 'ui-layer', 'input', 'UiLayer');
  const sourceJoystick = join(sourceRoot, 'joystick');
  const destinationJoystick = join(destination, 'joystick');
  mkdirSync(destinationJoystick, { recursive: true });
  const selectedModifiers = selectedUiLayerModifiers(commonRoot, config);
  const tailoredModifiers = tailorModifiers(readFileSync(join(sourceRoot, 'modifiers.lua'), 'utf8'), activePhysicalDevices, selectedModifiers);
  const availableModifiers = new Set(parseDcsModifiersLua(tailoredModifiers, { filename: 'UiLayer/modifiers.lua' }).modifiers.map(({ name }) => name));
  writeFileSync(join(destination, 'modifiers.lua'), tailoredModifiers, 'utf8');

  const copiedProfiles = [];
  const skippedUiLayerProfiles = [];
  for (const filename of readdirSync(sourceJoystick).filter((name) => name.endsWith('.diff.lua'))) {
    if (!activePhysicalDevices.has(physicalDeviceName(filename))) {
      skippedUiLayerProfiles.push({ filename, reason: 'device not active in target module configuration' });
      continue;
    }
    const tailored = tailorDiffLua(readFileSync(join(sourceJoystick, filename), 'utf8'), availableModifiers, { filename });
    if (!hasEffectiveAdditions(tailored, { filename })) {
      skippedUiLayerProfiles.push({ filename, reason: 'no effective additions after modifier tailoring' });
      continue;
    }
    writeFileSync(join(destinationJoystick, filename), tailored, 'utf8');
    copiedProfiles.push(filename);
  }
  return {
    activePhysicalDevices: [...activePhysicalDevices].sort(), activeProfiles: activeProfiles.sort(),
    availableModifiers: [...availableModifiers].sort(), copiedProfiles: copiedProfiles.sort(),
    skippedProfiles, skippedUiLayerProfiles,
  };
}

function main(argv = process.argv.slice(2)) {
  const [commonRoot, consumerJoystickDir, destination, configPath] = argv;
  if (!commonRoot || !consumerJoystickDir || !destination) {
    console.error('Usage: node package-ui-layer-input.mjs <common-root> <consumer-joystick-dir> <destination> [kneeboard-config]');
    return 1;
  }
  const result = packageUiLayerInput({ commonRoot: resolve(commonRoot), consumerJoystickDir: resolve(consumerJoystickDir),
    destination: resolve(destination), configPath: configPath ? resolve(configPath) : undefined });
  console.log(`Configured module profiles: ${result.activeProfiles.join(', ') || 'none'}`);
  for (const skipped of result.skippedProfiles) console.log(`Skipped module profile ${skipped.filename}: ${skipped.reason}`);
  console.log(`Available UI Layer modifiers: ${result.availableModifiers.join(', ') || 'none'}`);
  console.log(`Packaged ${result.copiedProfiles.length} UI Layer profile(s) for: ${result.activePhysicalDevices.join(', ') || 'no joystick devices'}`);
  for (const skipped of result.skippedUiLayerProfiles) console.log(`Skipped UI Layer profile ${skipped.filename}: ${skipped.reason}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
