#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';
import { summarizeEffectiveAdditions } from './effective-profile-applicability.mjs';

const CATEGORIES = ['joystick', 'keyboard', 'mouse'];

function files(root) {
  const result = [];
  for (const category of CATEGORIES) {
    const directory = join(root, category);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter((value) => value.endsWith('.diff.lua')).sort()) {
      result.push({ category, name, relativePath: `${category}/${name}`, absolutePath: join(directory, name) });
    }
  }
  if (existsSync(join(root, 'modifiers.lua'))) result.push({ category: 'root', name: 'modifiers.lua', relativePath: 'modifiers.lua', absolutePath: join(root, 'modifiers.lua') });
  return result;
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function devicePossibilities(root) {
  const sharedRoot = dirname(dirname(dirname(root)));
  const manifestPath = join(sharedRoot, 'hardware', 'manifest.json');
  const overlaysPath = join(dirname(dirname(root)), 'hardware-overlays.json');
  if (!existsSync(manifestPath) || !existsSync(overlaysPath)) return [];

  const hardware = JSON.parse(readFileSync(manifestPath, 'utf8')).devices ?? [];
  const overlays = JSON.parse(readFileSync(overlaysPath, 'utf8'));
  return hardware.flatMap((device) => {
    const overlay = overlays.devices?.[device.id];
    const exemption = overlays.exemptions?.[device.id];
    const identities = [device.id, ...(device.aliases ?? [])];
    return identities.map((deviceId) => ({
      deviceId,
      canonicalDeviceId: device.id,
      label: device.label,
      modifier: device.uiLayerModifiers?.[deviceId]
        ?? (deviceId === device.id ? device.uiLayerModifier : null)
        ?? null,
      overlayStatus: exemption ? 'exempt' : overlay?.status ?? 'template',
      instances: overlay?.appliesToInstances ?? [],
      catalogState: 'Definitive possibility',
      applicability: 'Resolved from each module\'s effective profiles',
    }));
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

export function inspectCatalog(rootArg) {
  const root = resolve(rootArg);
  const errors = [];
  const profiles = [];
  const bindings = [];
  let modifiers = [];
  for (const file of files(root)) {
    const source = readFileSync(file.absolutePath, 'utf8');
    if (file.name === 'modifiers.lua') {
      try { modifiers = parseDcsModifiersLua(source, { filename: file.relativePath }).modifiers; }
      catch (error) { errors.push(String(error.message ?? error)); }
      continue;
    }
    try {
      const parsed = parseDcsDiffLua(source, { filename: file.relativePath });
      const summary = summarizeEffectiveAdditions(parsed);
      profiles.push({ ...file, absolutePath: undefined, fingerprint: sha256(source), keyCount: summary.keyCount,
        axisCount: summary.axisCount, effectiveCount: summary.additions.length });
      bindings.push(...summary.additions.map((binding) => ({ profile: file.name, category: file.category, ...binding,
        chord: binding.reformers.join(' + ') || 'Base (no modifier)' })));
    } catch (error) {
      errors.push(String(error.message ?? error));
    }
  }
  const declared = new Set(modifiers.map(({ name }) => name));
  for (const binding of bindings) for (const modifier of binding.reformers) {
    if (!declared.has(modifier)) errors.push(`${binding.profile}: ${binding.command} references undeclared modifier ${modifier}`);
  }
  const functionsPath = join(dirname(dirname(root)), 'functions.json');
  let functionCount = null;
  if (existsSync(functionsPath)) {
    try {
      const functions = JSON.parse(readFileSync(functionsPath, 'utf8')).functions ?? [];
      functionCount = functions.length;
      const commands = new Set(functions.map(({ command }) => command));
      for (const binding of bindings) {
        if (!commands.has(binding.command)) errors.push(`${binding.profile}: ${binding.command} is missing from functions.json`);
      }
    } catch (error) {
      errors.push(`functions.json: ${String(error.message ?? error)}`);
    }
  }
  const sharedRoot = dirname(dirname(dirname(root)));
  const catalogFiles = [
    ...files(root).map((file) => ({ name: `input/UiLayer/${file.relativePath}`, path: file.absolutePath })),
    { name: 'functions.json', path: join(dirname(dirname(root)), 'functions.json') },
    { name: 'hardware-overlays.json', path: join(dirname(dirname(root)), 'hardware-overlays.json') },
    { name: 'hardware/manifest.json', path: join(sharedRoot, 'hardware', 'manifest.json') },
  ].filter((file) => existsSync(file.path));
  const fingerprint = sha256(catalogFiles.map((file) => `${file.name}\0${sha256(readFileSync(file.path))}`).join('\n'));
  const possibilities = devicePossibilities(root);
  const catalogState = possibilities.length ? 'Definitive' : 'Observed snapshot';
  return { root, scope: possibilities.length ? 'Definitive catalog' : 'Observed snapshot', fingerprint,
    profiles: profiles.map((profile) => ({ ...profile, catalogState })),
    bindings: bindings.map((binding) => ({ ...binding, catalogState })),
    modifiers: modifiers.map((modifier) => ({ ...modifier, catalogState: possibilities.length ? 'Definitive' : 'Observed' })),
    possibilities, errors, valid: errors.length === 0,
    summary: { profiles: profiles.length, bindings: bindings.length, keys: profiles.reduce((n, item) => n + item.keyCount, 0),
      axes: profiles.reduce((n, item) => n + item.axisCount, 0), modifiers: modifiers.length, functions: functionCount,
      possibilities: possibilities.length, errors: errors.length } };
}

export function compareCatalogs(canonicalArg, sourceArg) {
  const canonical = resolve(canonicalArg);
  const source = resolve(sourceArg);
  const current = new Map(files(canonical).map((file) => [file.relativePath, file]));
  const incoming = new Map(files(source).map((file) => [file.relativePath, file]));
  const changes = [];
  for (const relativePath of [...new Set([...current.keys(), ...incoming.keys()])].sort()) {
    const left = current.get(relativePath);
    const right = incoming.get(relativePath);
    const same = left && right && readFileSync(left.absolutePath).equals(readFileSync(right.absolutePath));
    const state = same ? 'Unchanged' : !left ? 'New' : !right ? 'CanonicalOnly' : 'Changed';
    changes.push({ relativePath, state, action: state === 'New' ? 'Add' : state === 'Changed' ? 'Replace' : 'Keep' });
  }
  const canonicalCatalog = inspectCatalog(canonical);
  const sourceCatalog = inspectCatalog(source);
  const stateByPath = new Map(changes.map((change) => [change.relativePath, change.state]));
  canonicalCatalog.profiles = canonicalCatalog.profiles.map((profile) => ({ ...profile,
    catalogState: stateByPath.get(profile.relativePath) === 'CanonicalOnly'
      ? 'Definitive only'
      : stateByPath.get(profile.relativePath) === 'Changed'
        ? 'Definitive + changed observation'
        : 'Definitive + observed' }));
  const bindingKey = (binding) => [binding.category, binding.profile, binding.section, binding.command, binding.key, binding.chord].join('\0');
  const observedBindings = new Set(sourceCatalog.bindings.map(bindingKey));
  canonicalCatalog.bindings = canonicalCatalog.bindings.map((binding) => ({ ...binding,
    catalogState: observedBindings.has(bindingKey(binding)) ? 'Definitive + observed' : 'Definitive only' }));
  const modifierKey = (modifier) => [modifier.name, modifier.device, modifier.key, modifier.mode].join('\0');
  const observedModifiers = new Set(sourceCatalog.modifiers.map(modifierKey));
  canonicalCatalog.modifiers = canonicalCatalog.modifiers.map((modifier) => ({ ...modifier,
    catalogState: observedModifiers.has(modifierKey(modifier)) ? 'Definitive + observed' : 'Definitive only' }));
  sourceCatalog.profiles = sourceCatalog.profiles.map((profile) => ({ ...profile, catalogState: 'Observed snapshot' }));
  sourceCatalog.bindings = sourceCatalog.bindings.map((binding) => ({ ...binding, catalogState: 'Observed snapshot' }));
  return { canonical: canonicalCatalog, source: sourceCatalog, changes };
}

export function applyReconciliation(canonicalArg, sourceArg, decisions) {
  const canonical = resolve(canonicalArg);
  const source = resolve(sourceArg);
  const parent = dirname(canonical);
  const stage = join(parent, `.UiLayer-stage-${randomUUID()}`);
  const backup = join(parent, `.UiLayer-backup-${randomUUID()}`);
  cpSync(canonical, stage, { recursive: true });
  try {
    for (const decision of decisions) {
      const destination = join(stage, decision.relativePath);
      const incoming = join(source, decision.relativePath);
      if (decision.action === 'Remove') rmSync(destination, { force: true });
      else if (decision.action === 'Add' || decision.action === 'Replace') {
        if (!existsSync(incoming)) throw new Error(`${decision.relativePath}: selected ${decision.action} but source file is missing.`);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(incoming, destination);
      }
    }
    const inspected = inspectCatalog(stage);
    if (!inspected.valid) throw new Error(`Catalog validation failed:\n${inspected.errors.join('\n')}`);
    renameSync(canonical, backup);
    try { renameSync(stage, canonical); }
    catch (error) { renameSync(backup, canonical); throw error; }
    rmSync(backup, { recursive: true, force: true });
    return inspectCatalog(canonical);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, canonical, source, decisionsPath] = argv;
  if (command === 'inspect' && canonical) console.log(JSON.stringify(inspectCatalog(canonical)));
  else if (command === 'compare' && canonical && source) console.log(JSON.stringify(compareCatalogs(canonical, source)));
  else if (command === 'apply' && canonical && source && decisionsPath) {
    console.log(JSON.stringify(applyReconciliation(canonical, source, JSON.parse(readFileSync(decisionsPath, 'utf8')))));
  } else throw new Error('Usage: manage-ui-layer-catalog.mjs inspect <catalog> | compare <catalog> <source> | apply <catalog> <source> <decisions.json>');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
