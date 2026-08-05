#!/usr/bin/env node
/**
 * DCS Input Profile Importer — scaffold engine (Option A core).
 *
 * Phase 1: --preview-json only (no consumer tree write).
 * Requires Node.js on PATH. WPF shell will invoke this CLI later.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultCommonRoot = resolve(scriptDir, '..');

function printHelp() {
  const text = `
DCS Input Profile Importer — scaffold engine

Usage:
  node scripts/scaffold-consumer.mjs --preview-json <out.json> --profiles-dir <dir> [options]

Required:
  --preview-json <path>   Write structured preview rows (no consumer tree mutation)
  --profiles-dir <path>   Directory of DCS *.diff.lua profiles

Optional:
  --modifiers <path>      Native DCS modifiers.lua
  --map <path>            JSON overrides: { "<profile basename or stem>": "<deviceId>" }
  --common-root <path>    DCS-Common root (default: repo containing this script)
  --help                  Show this help

Exit codes: 0 success, 1 usage/validation error, 2 parse failures present in report
`.trim();
  console.log(text);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    previewJson: null,
    profilesDir: null,
    modifiersPath: null,
    mapPath: null,
    commonRoot: defaultCommonRoot,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--preview-json') options.previewJson = next();
    else if (arg === '--profiles-dir') options.profilesDir = next();
    else if (arg === '--modifiers') options.modifiersPath = next();
    else if (arg === '--map') options.mapPath = next();
    else if (arg === '--common-root') options.commonRoot = resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function stripGuidSuffix(filename) {
  return filename
    .replace(/\.diff\.lua$/i, '')
    .replace(/\s*\{[0-9A-Fa-f-]{36}\}\s*$/u, '')
    .trimEnd();
}

export function loadDeviceMap(commonRoot) {
  const path = join(commonRoot, 'assets/shared/hardware/scaffold-device-map.json');
  if (!existsSync(path)) throw new Error(`Missing device map: ${path}`);
  const map = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(map.mappings)) throw new Error('scaffold-device-map.json requires mappings[]');
  return map;
}

export function loadManifestDeviceIds(commonRoot) {
  const path = join(commonRoot, 'assets/shared/hardware/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return new Set((manifest.devices ?? []).map((device) => device.id));
}

export function resolveDeviceMapping(profileFileName, deviceMap, overrides = {}) {
  const stem = stripGuidSuffix(profileFileName);
  const override =
    overrides[profileFileName] ??
    overrides[stem] ??
    overrides[profileFileName.replace(/\.diff\.lua$/i, '')];
  if (override) {
    return { deviceId: override, matchedPattern: null, source: 'override', stem };
  }
  const haystack = stem.toLocaleLowerCase();
  for (const entry of deviceMap.mappings) {
    for (const pattern of entry.patterns ?? []) {
      if (haystack.includes(String(pattern).toLocaleLowerCase())) {
        return { deviceId: entry.deviceId, matchedPattern: pattern, source: 'pattern', stem };
      }
    }
  }
  return { deviceId: null, matchedPattern: null, source: 'unmapped', stem };
}

export function resolveInstanceHint(stem, deviceId, deviceMap) {
  for (const entry of deviceMap.instancePatterns ?? []) {
    if (entry.deviceId !== deviceId) continue;
    const match = new RegExp(entry.regex, 'i').exec(stem);
    if (match) return match[entry.group ?? 1] ?? null;
  }
  return null;
}

/** Best-effort extraction of control id/key pairs from shared Lua catalogs. */
export function loadCalloutCatalog(commonRoot, deviceId) {
  if (!deviceId) return { byKey: new Map(), controls: [] };
  const manifest = JSON.parse(readFileSync(join(commonRoot, 'assets/shared/hardware/manifest.json'), 'utf8'));
  const device = manifest.devices.find((entry) => entry.id === deviceId);
  if (!device?.lua) return { byKey: new Map(), controls: [] };
  const luaPath = join(commonRoot, 'assets/shared/hardware', device.lua);
  if (!existsSync(luaPath)) return { byKey: new Map(), controls: [] };
  const source = readFileSync(luaPath, 'utf8');
  const controls = [];
  const blockPattern = /\{\s*id\s*=\s*"((?:\\.|[^"])*)"\s*,\s*key\s*=\s*"((?:\\.|[^"])*)"/g;
  for (let match; (match = blockPattern.exec(source));) {
    controls.push({ id: match[1], key: match[2] });
  }
  const byKey = new Map();
  for (const control of controls) {
    if (!byKey.has(control.key)) byKey.set(control.key, []);
    byKey.get(control.key).push(control.id);
  }
  return { byKey, controls };
}

function chordKey(reformers = []) {
  return [...reformers].sort((a, b) => a.localeCompare(b)).join('+');
}

export function buildPreview({ profilesDir, modifiersPath = null, mapPath = null, commonRoot = defaultCommonRoot }) {
  if (!profilesDir || !existsSync(profilesDir) || !statSync(profilesDir).isDirectory()) {
    throw new Error(`profiles directory not found: ${profilesDir}`);
  }
  const deviceMap = loadDeviceMap(commonRoot);
  const knownIds = loadManifestDeviceIds(commonRoot);
  const overrides = mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};

  let modifiers = [];
  const modifierErrors = [];
  if (modifiersPath) {
    if (!existsSync(modifiersPath)) throw new Error(`modifiers file not found: ${modifiersPath}`);
    try {
      modifiers = parseDcsModifiersLua(readFileSync(modifiersPath, 'utf8'), { filename: basename(modifiersPath) }).modifiers;
    } catch (error) {
      modifierErrors.push(String(error.message ?? error));
    }
  }
  const modifierByName = new Map(modifiers.map((modifier) => [modifier.name, modifier]));

  const profileFiles = readdirSync(profilesDir)
    .filter((name) => name.toLowerCase().endsWith('.diff.lua'))
    .sort((left, right) => left.localeCompare(right));

  const devices = [];
  const rows = [];
  const errors = [...modifierErrors];
  const catalogCache = new Map();

  for (const fileName of profileFiles) {
    const absolute = join(profilesDir, fileName);
    const mapping = resolveDeviceMapping(fileName, deviceMap, overrides);
    if (mapping.deviceId && !knownIds.has(mapping.deviceId)) {
      errors.push(`${fileName}: mapped deviceId '${mapping.deviceId}' is not in the shared hardware manifest`);
      mapping.deviceId = null;
      mapping.source = 'invalid-override';
    }
    const instanceHint = resolveInstanceHint(mapping.stem, mapping.deviceId, deviceMap);
    if (!catalogCache.has(mapping.deviceId)) {
      catalogCache.set(mapping.deviceId, loadCalloutCatalog(commonRoot, mapping.deviceId));
    }
    const catalog = catalogCache.get(mapping.deviceId);

    let bindings = [];
    try {
      bindings = parseDcsDiffLua(readFileSync(absolute, 'utf8'), { filename: fileName }).bindings;
    } catch (error) {
      errors.push(`${fileName}: ${error.message ?? error}`);
      devices.push({
        profileFile: fileName,
        stem: mapping.stem,
        deviceId: mapping.deviceId,
        matchedPattern: mapping.matchedPattern,
        mappingSource: mapping.source,
        instanceHint,
        bindingCount: 0,
        parseError: String(error.message ?? error),
      });
      continue;
    }

    devices.push({
      profileFile: fileName,
      stem: mapping.stem,
      deviceId: mapping.deviceId,
      matchedPattern: mapping.matchedPattern,
      mappingSource: mapping.source,
      instanceHint,
      bindingCount: bindings.reduce((count, binding) => count + binding.added.length, 0),
      parseError: null,
    });

    for (const binding of bindings) {
      for (const input of binding.added) {
        const reformers = input.reformers ?? [];
        const modifierModes = reformers.map((name) => modifierByName.get(name)?.mode ?? null);
        const calloutIds = catalog.byKey.get(input.key) ?? [];
        let status = 'OK';
        if (!mapping.deviceId) status = 'Unmapped device';
        else if (calloutIds.length === 0) status = 'No callout';

        // Ambiguity: same profile + key + chord maps to multiple commands
        const sameChordCommands = bindings.filter((candidate) =>
          candidate.added.some(
            (entry) => entry.key === input.key && chordKey(entry.reformers) === chordKey(reformers),
          ),
        );
        if (sameChordCommands.length > 1) status = status === 'OK' ? 'Ambiguous' : `${status}; Ambiguous`;

        rows.push({
          profileFile: fileName,
          stem: mapping.stem,
          deviceId: mapping.deviceId,
          mappingSource: mapping.source,
          matchedPattern: mapping.matchedPattern,
          instanceHint,
          section: binding.section,
          command: binding.command,
          name: binding.name,
          key: input.key,
          reformers,
          chord: chordKey(reformers),
          modifierModes,
          calloutId: calloutIds[0] ?? null,
          calloutIds,
          status,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedBy: 'scaffold-consumer.mjs',
    mode: 'preview',
    commonRoot,
    profilesDir: resolve(profilesDir),
    modifiersPath: modifiersPath ? resolve(modifiersPath) : null,
    modifiers: modifiers.map(({ name, device, key, mode }) => ({ name, device, key, mode })),
    devices,
    rows,
    summary: {
      profileCount: profileFiles.length,
      rowCount: rows.length,
      mappedDevices: devices.filter((device) => device.deviceId).length,
      unmappedDevices: devices.filter((device) => !device.deviceId).length,
      errorCount: errors.length,
      statusCounts: rows.reduce((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      }, {}),
    },
    errors,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!options.previewJson || !options.profilesDir) {
    printHelp();
    console.error('\nError: --preview-json and --profiles-dir are required.');
    return 1;
  }

  const preview = buildPreview({
    profilesDir: options.profilesDir,
    modifiersPath: options.modifiersPath,
    mapPath: options.mapPath,
    commonRoot: options.commonRoot,
  });

  writeFileSync(options.previewJson, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  console.log(`Wrote preview: ${options.previewJson}`);
  console.log(
    `Profiles=${preview.summary.profileCount} rows=${preview.summary.rowCount} mapped=${preview.summary.mappedDevices} unmapped=${preview.summary.unmappedDevices} errors=${preview.summary.errorCount}`,
  );
  return preview.errors.length > 0 ? 2 : 0;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
