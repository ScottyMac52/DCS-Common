#!/usr/bin/env node
/**
 * DCS Input Profile Importer — scaffold engine (Option A core).
 *
 * Preview: --preview-json
 * Write:   --output-dir (+ identity flags) materializes a consumer skeleton.
 * Requires Node.js on PATH.
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  copyFileSync,
  cpSync,
} from 'node:fs';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDcsDiffLua, parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultCommonRoot = resolve(scriptDir, '..');

function printHelp() {
  console.log(`
DCS Input Profile Importer — scaffold engine

Preview:
  node scripts/scaffold-consumer.mjs --preview-json <out.json> --profiles-dir <dir> [options]

Write consumer skeleton:
  node scripts/scaffold-consumer.mjs --output-dir <dir> --profiles-dir <dir> \\
    --display-name "F-16C" --input-module-id F-16C_50 --kneeboard-id F-16C_50 [options]

Required (preview):
  --preview-json <path>
  --profiles-dir <path>

Required (write):
  --output-dir <path>
  --profiles-dir <path>
  --display-name <text>
  --input-module-id <id>
  --kneeboard-id <id>

Optional:
  --modifiers <path>
  --map <path>
  --common-root <path>
  --repo-name <name>          default: derived from display name
  --dry-run                   report planned writes without creating files
  --help

Exit: 0 ok, 1 usage/error, 2 preview/write completed with reported errors
`.trim());
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    previewJson: null,
    outputDir: null,
    profilesDir: null,
    modifiersPath: null,
    mapPath: null,
    commonRoot: defaultCommonRoot,
    displayName: null,
    inputModuleId: null,
    kneeboardId: null,
    repoName: null,
    dryRun: false,
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
    else if (arg === '--output-dir') options.outputDir = next();
    else if (arg === '--profiles-dir') options.profilesDir = next();
    else if (arg === '--modifiers') options.modifiersPath = next();
    else if (arg === '--map') options.mapPath = next();
    else if (arg === '--common-root') options.commonRoot = resolve(next());
    else if (arg === '--display-name') options.displayName = next();
    else if (arg === '--input-module-id') options.inputModuleId = next();
    else if (arg === '--kneeboard-id') options.kneeboardId = next();
    else if (arg === '--repo-name') options.repoName = next();
    else if (arg === '--dry-run') options.dryRun = true;
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

export function loadCalloutCatalog(commonRoot, deviceId) {
  if (!deviceId) return { byKey: new Map(), controls: [] };
  const manifest = JSON.parse(readFileSync(join(commonRoot, 'assets/shared/hardware/manifest.json'), 'utf8'));
  const device = manifest.devices.find((entry) => entry.id === deviceId);
  if (!device?.lua) return { byKey: new Map(), controls: [] };
  const luaPath = join(commonRoot, 'assets/shared/hardware', device.lua);
  if (!existsSync(luaPath)) return { byKey: new Map(), controls: [] };
  const source = readFileSync(luaPath, 'utf8');
  const controls = [];
  // Full schema: { id = "...", key = "..." } (either field order)
  const withId = /\{\s*(?:id\s*=\s*"((?:\\.|[^"])*)"\s*,\s*key\s*=\s*"((?:\\.|[^"])*)"|key\s*=\s*"((?:\\.|[^"])*)"\s*,\s*id\s*=\s*"((?:\\.|[^"])*)")/g;
  for (let match; (match = withId.exec(source));) {
    const id = match[1] ?? match[4];
    const key = match[2] ?? match[3];
    if (id && key) controls.push({ id, key });
  }
  // Lightweight bindings fallback when no id+key pairs found
  if (controls.length === 0) {
    const bindingPattern = /\{\s*key\s*=\s*"((?:\\.|[^"])*)"[^}]*\}/g;
    const svgPath = device.svg ? join(commonRoot, 'assets/shared/hardware', device.svg) : null;
    const svgIds = [];
    if (svgPath && existsSync(svgPath)) {
      const svg = readFileSync(svgPath, 'utf8');
      for (const m of svg.matchAll(/<text id="lbl-([^"]+)"/g)) svgIds.push(m[1]);
    }
    let index = 0;
    for (let match; (match = bindingPattern.exec(source));) {
      const key = match[1];
      if (/[-\/]/.test(key)) continue;
      const id = svgIds[index] ?? key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      controls.push({ id, key });
      index += 1;
    }
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

function slugifyId(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function profileKeyFromDevice(device) {
  const base = device.deviceId ?? slugifyId(device.stem || 'device').toLowerCase();
  if (device.instanceHint) return `${base}-${device.instanceHint}`;
  return base;
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

function readTemplate(commonRoot, name) {
  const path = join(commonRoot, 'templates/consumer', name);
  if (!existsSync(path)) throw new Error(`Missing template: ${path}`);
  return readFileSync(path, 'utf8');
}

function applyTokens(template, tokens) {
  let text = template;
  for (const [key, value] of Object.entries(tokens)) {
    text = text.replaceAll(`{{${key}}}`, String(value));
  }
  return text;
}

function aliasFromModifierName(name) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'MOD';
}

/** Draft kneeboard.json from preview rows (base chord only for controls; layers stubbed when modifiers exist). */
export function buildDraftKneeboardConfig(preview, { displayName, inputModuleId }) {
  const profiles = {};
  for (const device of preview.devices) {
    if (!device.deviceId) continue;
    const key = profileKeyFromDevice(device);
    profiles[key] = `src/Config/Input/${inputModuleId}/joystick/${device.profileFile}`;
  }

  const modifiers = {};
  for (const mod of preview.modifiers) {
    const alias = aliasFromModifierName(mod.name);
    modifiers[alias] = {
      nativeName: mod.name,
      mode: mod.mode,
    };
  }

  const pagesByDevice = new Map();
  let pageIndex = 1;
  for (const device of preview.devices) {
    if (!device.deviceId) continue;
    const profileKey = profileKeyFromDevice(device);
    const title = device.stem || device.deviceId;
    const file = `${String(pageIndex).padStart(2, '0')}-${slugifyId(profileKey).toUpperCase()}`;
    pageIndex += 1;

    const controls = {};
    const labels = {};
    const layerControls = new Map();

    for (const row of preview.rows) {
      if (row.profileFile !== device.profileFile) continue;
      if (!row.calloutId) continue;
      // Include keyDiffs and axisDiffs so throttle/stick/rudder axes are scaffolded.

      const displayName = row.name || row.key;

      if (!row.chord) {
        if (!controls[row.calloutId]) {
          controls[row.calloutId] = { profile: profileKey, key: row.key };
          labels[row.calloutId] = displayName;
        }
      } else {
        if (!layerControls.has(row.chord)) {
          layerControls.set(row.chord, { controls: {}, labels: {} });
        }
        const layer = layerControls.get(row.chord);
        if (!layer.controls[row.calloutId]) {
          layer.controls[row.calloutId] = { profile: profileKey, key: row.key };
          layer.labels[row.calloutId] = displayName;
        }
      }
    }

    const page = {
      file,
      deviceId: device.deviceId,
      title,
      kicker: device.instanceHint ? `INSTANCE ${device.instanceHint}` : 'SCAFFOLD DRAFT',
      _comment:
        'labels are pre-filled from DCS binding names via controls. Edit any string to override display text; ' +
        'keep callout IDs in sync with controls. You can also set "label" on a controls entry.',
      labels,
    };

    if (layerControls.size === 0) {
      page.controls = controls;
    } else {
      const layers = [
        { id: 'base', controls, labels: { ...labels } },
      ];
      for (const [chord, layerMap] of layerControls) {
        const aliases = chord.split('+').map((native) => {
          const found = Object.entries(modifiers).find(([, value]) => value.nativeName === native);
          return found?.[0] ?? aliasFromModifierName(native);
        });
        layers.push({
          id: aliases.join('_') || 'layer',
          file: `${file}-${aliases.join('-') || 'LAYER'}`,
          title: `${title} • ${chord}`,
          modifiers: aliases,
          controls: layerMap.controls,
          labels: layerMap.labels,
        });
      }
      page.layers = layers;
    }

    pagesByDevice.set(profileKey, page);
  }

  const config = {
    schemaVersion: 1,
    aircraft: displayName,
    profiles,
    pages: [...pagesByDevice.values()],
  };

  if (Object.keys(modifiers).length > 0) {
    config.modifiersFile = `src/Config/Input/${inputModuleId}/modifiers.lua`;
    config.modifiers = modifiers;
  }

  return config;
}

export function writeConsumer({ preview, outputDir, displayName, inputModuleId, kneeboardId, repoName, dryRun = false, commonRoot = defaultCommonRoot }) {
  const out = resolve(outputDir);
  const name = repoName ?? `DCS-${slugifyId(displayName)}-Components`;
  const tokens = {
    DISPLAY_NAME: displayName,
    INPUT_MODULE_ID: inputModuleId,
    KNEEBOARD_ID: kneeboardId,
    REPO_NAME: name,
    ARTIFACT_NAME: slugifyId(displayName),
  };

  const planned = [];
  const write = (rel, content) => {
    planned.push(rel);
    if (dryRun) return;
    const absolute = join(out, rel);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  };
  const copy = (from, rel) => {
    planned.push(rel);
    if (dryRun) return;
    const absolute = join(out, rel);
    mkdirSync(dirname(absolute), { recursive: true });
    copyFileSync(from, absolute);
  };

  const joystickRel = `src/Config/Input/${inputModuleId}/joystick`;
  for (const device of preview.devices) {
    const source = join(preview.profilesDir, device.profileFile);
    copy(source, `${joystickRel}/${device.profileFile}`);
  }
  if (preview.modifiersPath && existsSync(preview.modifiersPath)) {
    copy(preview.modifiersPath, `src/Config/Input/${inputModuleId}/modifiers.lua`);
  }

  const kneeboard = buildDraftKneeboardConfig(preview, { displayName, inputModuleId });
  write('config/kneeboard.json', JSON.stringify(kneeboard, null, 2));

  write('package.json', applyTokens(readTemplate(commonRoot, 'package.json.tmpl'), tokens));
  write('README.md', applyTokens(readTemplate(commonRoot, 'README.md.tmpl'), tokens));
  write('scripts/build-kneeboard.mjs', readTemplate(commonRoot, 'build-kneeboard.mjs.tmpl'));
  write('scripts/test-kneeboard.mjs', applyTokens(readTemplate(commonRoot, 'test-kneeboard.mjs.tmpl'), tokens));
  write('scripts/version.mjs', readTemplate(commonRoot, 'version.mjs.tmpl'));
  write('scripts/test-versioning.mjs', readTemplate(commonRoot, 'test-versioning.mjs.tmpl'));
  write('.github/workflows/build.yml', applyTokens(readTemplate(commonRoot, 'build.yml.tmpl'), tokens));
  write('.github/workflows/release.yml', applyTokens(readTemplate(commonRoot, 'release.yml.tmpl'), tokens));
  write('packaging/ovgme/README.TXT', applyTokens(readTemplate(commonRoot, 'ovgme-README.TXT.tmpl'), tokens));
  write('packaging/release/RELEASE-NOTES.md', applyTokens(readTemplate(commonRoot, 'RELEASE-NOTES.md.tmpl'), tokens));

  write(
    'scripts/Build-OvGME.ps1',
    applyTokens(readTemplate(commonRoot, 'Build-OvGME.ps1.tmpl'), tokens),
  );
  write(
    'scripts/Test-Package.ps1',
    applyTokens(readTemplate(commonRoot, 'Test-Package.ps1.tmpl'), tokens),
  );
  write(
    'scripts/Build-Release.ps1',
    applyTokens(readTemplate(commonRoot, 'Build-Release.ps1.tmpl'), tokens),
  );

  const reportLines = [
    '# SCAFFOLD-REPORT',
    '',
    `Generated by scaffold-consumer.mjs for **${displayName}**`,
    '',
    `- Input module: \`${inputModuleId}\``,
    `- Kneeboard ID: \`${kneeboardId}\``,
    `- Profiles: ${preview.summary.profileCount}`,
    `- Mapped devices: ${preview.summary.mappedDevices}`,
    `- Unmapped devices: ${preview.summary.unmappedDevices}`,
    `- Preview errors: ${preview.summary.errorCount}`,
    '',
    '## Devices',
    '',
    ...preview.devices.map(
      (d) =>
        `- \`${d.profileFile}\` → ${d.deviceId ?? '**UNMAPPED**'} (${d.mappingSource}${d.instanceHint ? `, instance ${d.instanceHint}` : ''})`,
    ),
    '',
    '## Next steps',
    '',
    '1. Review `config/kneeboard.json` (draft controls/layers).',
    '2. Review pre-filled `labels` (from DCS binding names). Edit strings to shorten display text; IDs must stay aligned with `controls`.',
    '3. Map any UNMAPPED devices via `--map` and re-run, or edit JSON by hand.',
    '4. `npm ci` and set `DCS_COMMON_ROOT` to a DCS-Common checkout.',
    '5. `npm run build:kneeboard` / `npm run test:kneeboard` / `npm run test:versioning`.',
    '6. Flesh out packaging scripts if the stubs need consumer-specific inventory checks.',
    '',
    '## Planned files',
    '',
    ...planned.map((p) => `- ${p}`),
  ];
  write('SCAFFOLD-REPORT.md', `${reportLines.join('\n')}\n`);

  return {
    outputDir: out,
    repoName: name,
    plannedFiles: planned,
    kneeboard,
    dryRun,
    errors: preview.errors,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  if (!options.profilesDir) {
    printHelp();
    console.error('\nError: --profiles-dir is required.');
    return 1;
  }

  const preview = buildPreview({
    profilesDir: options.profilesDir,
    modifiersPath: options.modifiersPath,
    mapPath: options.mapPath,
    commonRoot: options.commonRoot,
  });

  if (options.previewJson) {
    writeFileSync(options.previewJson, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
    console.log(`Wrote preview: ${options.previewJson}`);
  }

  if (options.outputDir) {
    if (!options.displayName || !options.inputModuleId || !options.kneeboardId) {
      console.error('Write mode requires --display-name, --input-module-id, and --kneeboard-id.');
      return 1;
    }
    const result = writeConsumer({
      preview,
      outputDir: options.outputDir,
      displayName: options.displayName,
      inputModuleId: options.inputModuleId,
      kneeboardId: options.kneeboardId,
      repoName: options.repoName,
      dryRun: options.dryRun,
      commonRoot: options.commonRoot,
    });
    console.log(
      `${result.dryRun ? 'Dry-run' : 'Wrote'} consumer under ${result.outputDir} (${result.plannedFiles.length} paths)`,
    );
  }

  if (!options.previewJson && !options.outputDir) {
    printHelp();
    console.error('\nError: provide --preview-json and/or --output-dir.');
    return 1;
  }

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
