#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';
import { summarizeEffectiveAdditions } from './effective-profile-applicability.mjs';
import { applyDcsCommandAssignments, loadCalloutCatalog, loadDeviceMap, resolveDeviceMapping,
  resolveCatalogInputKey, resolveInstanceHint, serializeDcsProfile } from './scaffold-consumer.mjs';

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
  const warnings = [];
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
  const sharedRoot = dirname(dirname(dirname(root)));
  let functionCount = null;
  let functions = [];
  if (existsSync(functionsPath)) {
    try {
      functions = JSON.parse(readFileSync(functionsPath, 'utf8')).functions ?? [];
      functionCount = functions.length;
      const commands = new Set(functions.map(({ command }) => command));
      for (const binding of bindings) {
        if (!commands.has(binding.command)) warnings.push(`${binding.profile}: ${binding.command} is unknown to functions.json and will be preserved`);
      }
    } catch (error) {
      errors.push(`functions.json: ${String(error.message ?? error)}`);
    }
  }
  if (existsSync(join(sharedRoot, 'hardware', 'scaffold-device-map.json'))) {
    const commonRoot = dirname(dirname(sharedRoot));
    const deviceMap = loadDeviceMap(commonRoot);
    const functionsByCommand = new Map(functions.map((item) => [item.command, item]));
    for (const binding of bindings) {
      const mapping = resolveDeviceMapping(binding.profile, deviceMap);
      binding.deviceId = mapping.deviceId;
      const instance = mapping.deviceId ? resolveInstanceHint(mapping.stem, mapping.deviceId, deviceMap) : null;
      binding.deviceInstance = mapping.deviceId === 'tm-mfd' && instance ? `MFD${instance}` : instance;
      binding.modifiers = binding.reformers;
      binding.functionId = functionsByCommand.get(binding.command)?.id ?? null;
      if (mapping.deviceId) {
        const catalogKey = resolveCatalogInputKey(mapping.deviceId, binding.key, deviceMap);
        const control = loadCalloutCatalog(commonRoot, mapping.deviceId).controls.find((item) => item.key === catalogKey);
        binding.controlId = control?.id ?? null;
        binding.hardwareLabel = control?.hardwareLabel ?? null;
      }
      binding.bindingId = [binding.deviceId, binding.deviceInstance, binding.functionId, ...binding.reformers].map((value) => value ?? '').join('|');
    }
  }
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
    possibilities, errors, warnings, valid: errors.length === 0,
    summary: { profiles: profiles.length, bindings: bindings.length, keys: profiles.reduce((n, item) => n + item.keyCount, 0),
      axes: profiles.reduce((n, item) => n + item.axisCount, 0), modifiers: modifiers.length, functions: functionCount,
      possibilities: possibilities.length, errors: errors.length } };
}

function safeName(value, context) {
  if (typeof value !== 'string' || !value.endsWith('.diff.lua') || value !== basename(value) || value.includes('..')) {
    throw new Error(`${context} must be a plain .diff.lua filename.`);
  }
  return value;
}

function emptyProfile() {
  return 'local diff = {\n}\nreturn diff\n';
}

function luaString(value) {
  return JSON.stringify(String(value));
}

export function serializeModifiers(modifiers) {
  const names = new Set();
  const physical = new Set();
  const sorted = [...modifiers].map((modifier, index) => {
    if (!modifier || typeof modifier !== 'object') throw new Error(`Modifier ${index + 1} must be an object.`);
    if (!modifier.name || !modifier.device || !modifier.key || !['hold', 'toggle'].includes(modifier.mode)) {
      throw new Error(`Modifier ${index + 1} requires name, device, key, and hold/toggle mode.`);
    }
    const folded = modifier.name.toLocaleLowerCase();
    if (names.has(folded)) throw new Error(`Duplicate modifier name: ${modifier.name}`);
    names.add(folded);
    const tuple = `${modifier.device.toLocaleLowerCase()}\0${modifier.key.toLocaleUpperCase()}`;
    if (physical.has(tuple)) throw new Error(`Duplicate modifier physical input: ${modifier.device} ${modifier.key}`);
    physical.add(tuple);
    return { name: modifier.name, device: modifier.device, key: modifier.key, mode: modifier.mode };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return `local modifiers = {\n${sorted.map((modifier) =>
    `\t[${luaString(modifier.name)}] = {\n\t\t["device"] = ${luaString(modifier.device)},\n\t\t["key"] = ${luaString(modifier.key)},\n\t\t["switch"] = ${modifier.mode === 'toggle'},\n\t},`
  ).join('\n')}\n}\nreturn modifiers\n`;
}

function canonicalProfilePath(uiRoot, profile) {
  if (!profile || !CATEGORIES.includes(profile.category)) throw new Error('Profile category must be joystick, keyboard, or mouse.');
  return join(uiRoot, 'input', 'UiLayer', profile.category, safeName(profile.filename, 'Profile filename'));
}

function migrateModifierReferences(uiRoot, renames) {
  if (!renames?.length) return;
  const renameMap = new Map(renames.map((item) => {
    if (!item?.from || !item?.to) throw new Error('Modifier rename requires from and to.');
    return [item.from, item.to];
  }));
  const inputRoot = join(uiRoot, 'input', 'UiLayer');
  for (const file of files(inputRoot).filter((item) => item.name !== 'modifiers.lua')) {
    const parsed = parseDcsDiffLua(readFileSync(file.absolutePath, 'utf8'), { filename: file.relativePath });
    let changed = false;
    for (const binding of parsed.bindings) for (const input of [...binding.added, ...(binding.changed ?? []), ...binding.removed]) {
      input.reformers = input.reformers.map((name) => renameMap.get(name) ?? name).sort();
      if (input.reformers.some((name) => renameMap.has(name))) changed = true;
    }
    if ([...renameMap.keys()].some((name) => readFileSync(file.absolutePath, 'utf8').includes(`"${name}"`))) changed = true;
    if (changed) writeFileSync(file.absolutePath, serializeDcsProfile(parsed), 'utf8');
  }
}

export function applyAuthoritativeEdits(commonRootArg, request) {
  const commonRoot = resolve(commonRootArg);
  const packagePath = join(commonRoot, 'package.json');
  if (!existsSync(packagePath) || JSON.parse(readFileSync(packagePath, 'utf8')).name !== 'dcs-common') {
    throw new Error('Authoritative edits require the root of a DCS-Common checkout.');
  }
  const canonicalInput = join(commonRoot, 'assets', 'shared', 'ui-layer', 'input', 'UiLayer');
  const current = inspectCatalog(canonicalInput);
  if (request.expectedFingerprint && request.expectedFingerprint !== current.fingerprint) {
    throw new Error(`Stale definitive UI Layer catalog: expected ${request.expectedFingerprint}, found ${current.fingerprint}. Reload before saving.`);
  }
  const liveUiRoot = join(commonRoot, 'assets', 'shared', 'ui-layer');
  const parent = dirname(liveUiRoot);
  const stage = join(parent, `.ui-layer-authoring-stage-${randomUUID()}`);
  const backup = join(parent, `.ui-layer-authoring-backup-${randomUUID()}`);
  cpSync(liveUiRoot, stage, { recursive: true });
  const changedFiles = new Set();
  try {
    const stagedInput = join(stage, 'input', 'UiLayer');
    if (request.modifiers) {
      migrateModifierReferences(stage, request.modifierRenames ?? []);
      const modifierSource = serializeModifiers(request.modifiers);
      writeFileSync(join(stagedInput, 'modifiers.lua'), modifierSource, 'utf8');
      changedFiles.add('input/UiLayer/modifiers.lua');
    }
    const functionsPath = join(stage, 'functions.json');
    const functionsDoc = JSON.parse(readFileSync(functionsPath, 'utf8'));
    const functionsByCommand = new Map((functionsDoc.functions ?? []).map((item) => [item.command, item]));
    for (const edit of request.bindings ?? []) {
      if (!['upsert', 'move', 'clear', 'relabel'].includes(edit.action)) throw new Error(`Unsupported binding action: ${edit.action}`);
      const fn = functionsByCommand.get(edit.command);
      if (!fn) throw new Error(`UI Layer command ${edit.command} is not in functions.json.`);
      if (edit.action === 'relabel') {
        if (typeof edit.label !== 'string') throw new Error('Relabel requires label.');
        fn.label = edit.label;
        changedFiles.add('functions.json');
        continue;
      }
      const profilePath = canonicalProfilePath(stage, edit.profile);
      mkdirSync(dirname(profilePath), { recursive: true });
      let source = existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : emptyProfile();
      const controlCatalog = loadCalloutCatalog(commonRoot, edit.profile.deviceId);
      const deviceMap = loadDeviceMap(commonRoot);
      const validateTarget = (target) => {
        const catalogKey = resolveCatalogInputKey(edit.profile.deviceId, target?.key, deviceMap);
        const control = controlCatalog.controls.find((item) => item.key === catalogKey);
        if (!control) throw new Error(`${edit.profile.deviceId}: ${target?.key ?? '(missing key)'} is not a supported canonical physical control.`);
        const expectedSection = control.type === 'axis' ? 'axisDiffs' : 'keyDiffs';
        if (edit.section !== expectedSection) throw new Error(`${target.key} requires ${expectedSection}, not ${edit.section}.`);
      };
      if (edit.action === 'move') { validateTarget(edit.from); validateTarget(edit.to); }
      else validateTarget(edit);
      const assignment = (target, clear = false) => ({ profileFile: edit.profile.filename, section: edit.section,
        key: target.key, reformers: target.reformers ?? [], command: edit.command, name: edit.name ?? fn.label,
        clear, allowCreate: !clear });
      const allowedInputs = controlCatalog.controls.flatMap((control) => {
        const section = control.type === 'axis' ? 'axisDiffs' : 'keyDiffs';
        const aliases = Object.entries(deviceMap.inputKeyAliases?.[edit.profile.deviceId] ?? {})
          .filter(([, canonical]) => canonical === control.key).map(([key]) => ({ key, section }));
        return [{ key: control.key, section }, ...aliases];
      });
      if (edit.action === 'move') {
        source = applyDcsCommandAssignments(source, [assignment(edit.from, true)], { filename: edit.profile.filename });
      }
      const target = edit.action === 'move' ? edit.to : edit;
      source = applyDcsCommandAssignments(source, [assignment(target, edit.action === 'clear')], {
        filename: edit.profile.filename,
        allowedInputs,
      });
      writeFileSync(profilePath, source, 'utf8');
      changedFiles.add(relative(stage, profilePath).replaceAll('\\', '/'));
    }
    if (changedFiles.has('functions.json')) writeFileSync(functionsPath, `${JSON.stringify(functionsDoc, null, 2)}\n`, 'utf8');
    const inspected = inspectCatalog(stagedInput);
    if (!inspected.valid) throw new Error(`Catalog validation failed:\n${inspected.errors.join('\n')}`);
    renameSync(liveUiRoot, backup);
    try { renameSync(stage, liveUiRoot); }
    catch (error) { renameSync(backup, liveUiRoot); throw error; }
    rmSync(backup, { recursive: true, force: true });
    return { ...inspectCatalog(canonicalInput), changedFiles: [...changedFiles].sort(),
      rebuild: { importerExe: false, consumerRescaffold: true, kneeboards: true, ovgmePackage: true } };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
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
  } else if (command === 'edit' && canonical && source) {
    console.log(JSON.stringify(applyAuthoritativeEdits(canonical, JSON.parse(readFileSync(source, 'utf8')))));
  } else throw new Error('Usage: manage-ui-layer-catalog.mjs inspect <catalog> | compare <catalog> <source> | apply <catalog> <source> <decisions.json> | edit <common-root> <request.json>');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
