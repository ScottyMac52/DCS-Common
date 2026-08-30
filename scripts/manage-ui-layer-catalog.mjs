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
  const fingerprint = sha256(files(root).map((file) => `${file.relativePath}\0${sha256(readFileSync(file.absolutePath))}`).join('\n'));
  return { root, fingerprint, profiles, bindings, modifiers, errors, valid: errors.length === 0,
    summary: { profiles: profiles.length, bindings: bindings.length, keys: profiles.reduce((n, item) => n + item.keyCount, 0),
      axes: profiles.reduce((n, item) => n + item.axisCount, 0), modifiers: modifiers.length, functions: functionCount,
      errors: errors.length } };
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
  return { canonical: inspectCatalog(canonical), source: inspectCatalog(source), changes };
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
