#!/usr/bin/env node
/**
 * DCS Input Profile Importer — scaffold engine (Option A core).
 *
 * Preview: --preview-json
 * Write:   --output-dir (+ identity flags) materializes a consumer skeleton.
 * Requires Node.js on PATH.
 */
import { createHash } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  unlinkSync,
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
  --map <path>                consumer-owned profile filename/stem to deviceId overrides (JSON)
  --roles <path>              consumer-owned profile filename/GUID to semantic instance roles (JSON)
  --semantic-modifiers <path> modifier name or device+key to semantic modifier ID (JSON)
  --labels <path>             stable binding identity to editable label override (JSON)
  --assignments <path>        pending physical-control command assignments (JSON)
  --repository-profiles <dir> existing consumer profiles whose assignments take precedence
  --mfd-categories <path>     profile key/file to top/right/bottom/left category labels (JSON)
  --page-presentation <path>   profile key/file to page title and kicker (JSON)
  --remove-profiles <path>    explicit repository profile keys to remove (JSON array)
  --exclude-ui-layer          do not compose shared UI Layer overlays into generated preview pages
  --moza-grip <value>          standalone, viper, or hornet; applies to generic AB9 profiles
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
    rolesPath: null,
    semanticModifiersPath: null,
    labelsPath: null,
    assignmentsPath: null,
    repositoryProfilesDir: null,
    mfdCategoriesPath: null,
    pagePresentationPath: null,
    removeProfilesPath: null,
    includeUiLayer: true,
    mozaGrip: null,
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
    else if (arg === '--roles') options.rolesPath = next();
    else if (arg === '--semantic-modifiers') options.semanticModifiersPath = next();
    else if (arg === '--labels') options.labelsPath = next();
    else if (arg === '--assignments') options.assignmentsPath = next();
    else if (arg === '--repository-profiles') options.repositoryProfilesDir = resolve(next());
    else if (arg === '--mfd-categories') options.mfdCategoriesPath = next();
    else if (arg === '--page-presentation') options.pagePresentationPath = next();
    else if (arg === '--remove-profiles') options.removeProfilesPath = next();
    else if (arg === '--exclude-ui-layer') options.includeUiLayer = false;
    else if (arg === '--moza-grip') options.mozaGrip = next().toLowerCase();
    else if (arg === '--common-root') options.commonRoot = resolve(next());
    else if (arg === '--display-name') options.displayName = next();
    else if (arg === '--input-module-id') options.inputModuleId = next();
    else if (arg === '--kneeboard-id') options.kneeboardId = next();
    else if (arg === '--repo-name') options.repoName = next();
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.mozaGrip && !['standalone', 'viper', 'hornet'].includes(options.mozaGrip)) {
    throw new Error('--moza-grip must be standalone, viper, or hornet');
  }
  return options;
}

export function extractProfileGuid(filename) {
  return filename.match(/\{([0-9A-Fa-f-]{36})\}(?=\.diff\.lua$)/iu)?.[1]?.toLowerCase() ?? null;
}

function stripGuidSuffix(filename) {
  return filename
    .replace(/\.diff\.lua$/i, '')
    .replace(/\s*\{[0-9A-Fa-f-]{36}\}\s*$/u, '')
    .trimEnd();
}

function normalizedPhysicalDevice(value) {
  return String(value ?? '')
    .replace(/\s*\{[0-9A-Fa-f-]{36}\}\s*$/u, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
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
  return new Set((manifest.devices ?? []).flatMap((device) => [device.id, ...(device.aliases ?? [])]));
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
        return { deviceId: entry.deviceId, matchedPattern: pattern, source: entry.source ?? 'pattern', stem };
      }
    }
  }
  return { deviceId: null, matchedPattern: null, source: 'unmapped', stem };
}

export function resolveCatalogInputKey(deviceId, inputKey, deviceMap) {
  return deviceMap.inputKeyAliases?.[deviceId]?.[inputKey] ?? inputKey;
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
  if (!deviceId) return { byKey: new Map(), labelById: new Map(), controls: [] };
  const manifest = JSON.parse(readFileSync(join(commonRoot, 'assets/shared/hardware/manifest.json'), 'utf8'));
  const device = manifest.devices.find((entry) => entry.id === deviceId || entry.aliases?.includes(deviceId));
  if (!device?.lua) return { byKey: new Map(), labelById: new Map(), controls: [] };
  const luaPath = join(commonRoot, 'assets/shared/hardware', device.lua);
  if (!existsSync(luaPath)) return { byKey: new Map(), labelById: new Map(), controls: [] };
  const source = readFileSync(luaPath, 'utf8');
  const svgPath = device.svg ? join(commonRoot, 'assets/shared/hardware', device.svg) : null;
  const renderableIds = new Set();
  if (svgPath && existsSync(svgPath)) {
    const svg = readFileSync(svgPath, 'utf8');
    for (const match of svg.matchAll(/<text id="lbl-([^"]+)"/g)) renderableIds.add(match[1]);
  }
  const controls = [];
  // Full schema: { id = "...", key = "..." } (either field order)
  const controlEntry = /\{([^{}]*\bid\s*=\s*"(?:\\.|[^"])*"[^{}]*)\}/g;
  for (let match; (match = controlEntry.exec(source));) {
    const field = (name) => match[1].match(new RegExp(`\\b${name}\\s*=\\s*"((?:\\\\.|[^"])*)"`))?.[1];
    const id = field('id');
    const key = field('key');
    const hardwareLabel = field('hardwareLabel') ?? null;
    const type = field('type') ?? (/^JOY_[XYZRUV]/u.test(key ?? '') ? 'axis' : 'button');
    if (id && key) controls.push({ id, key, type, hardwareLabel });
  }
  // Lightweight bindings fallback when no id+key pairs found
  if (controls.length === 0) {
    const bindingPattern = /\{\s*key\s*=\s*"((?:\\.|[^"])*)"[^}]*\}/g;
    const svgIds = [...renderableIds];
    let index = 0;
    for (let match; (match = bindingPattern.exec(source));) {
      const key = match[1];
      if (/[-\/]/.test(key)) continue;
      const id = svgIds[index] ?? key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      controls.push({ id, key });
      index += 1;
    }
  }
  const renderableControls = svgPath
    ? controls.filter((control) => renderableIds.has(control.id))
    : controls;
  const byKey = new Map();
  const labelById = new Map();
  for (const control of renderableControls) {
    if (!byKey.has(control.key)) byKey.set(control.key, []);
    byKey.get(control.key).push(control.id);
    if (control.hardwareLabel) labelById.set(control.id, control.hardwareLabel);
  }
  return { byKey, labelById, controls: renderableControls };
}

export function stableBindingId(row) {
  return [row.profileFile, row.section, row.command, row.key, row.chord].join('\0');
}

function luaString(value) {
  return JSON.stringify(String(value)).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}

function serializeInputs(name, inputs) {
  if (!inputs?.length) return '';
  const entries = inputs.map((input, index) => {
    const reformers = input.reformers?.length
      ? `, ["reformers"] = { ${input.reformers.map((value, i) => `[${i + 1}] = ${luaString(value)}`).join(', ')} }`
      : '';
    return `        [${index + 1}] = { ["key"] = ${luaString(input.key)}${reformers} },`;
  });
  return `      ["${name}"] = {\n${entries.join('\n')}\n      },\n`;
}

export function applyDcsCommandAssignments(source, assignments, { filename = 'profile.diff.lua', allowedInputs = null } = {}) {
  if (!assignments?.length) return source;
  const parsed = parseDcsDiffLua(source, { filename });
  normalizeLegacyChordCommandBindings(parsed);
  for (const assignment of assignments) {
    if (!['keyDiffs', 'axisDiffs'].includes(assignment.section)) {
      throw new Error(`${filename}: assignment section must be keyDiffs or axisDiffs`);
    }
    if ((!assignment.clear && (!assignment.command || !assignment.name)) || !assignment.key) {
      throw new Error(`${filename}: assignment requires command, name, and key`);
    }
    const reformers = [...new Set(assignment.reformers ?? [])].sort((a, b) => a.localeCompare(b));
    let foundControl = false;
    for (const binding of parsed.bindings.filter((item) => item.section === assignment.section)) {
      const retained = binding.added.filter((input) => {
        const matches = input.key === assignment.key && chordKey(input.reformers) === chordKey(reformers);
        if (matches) {
          foundControl = true;
          if (assignment.clear && !binding.removed.some((removed) => removed.key === input.key && chordKey(removed.reformers) === chordKey(input.reformers)))
            binding.removed.push(input);
        }
        return !matches;
      });
      binding.added = retained;
    }
    if (!foundControl && !(assignment.allowCreate && (allowedInputs === null || allowedInputs.some((input) => input.key === assignment.key && input.section === assignment.section)))) {
      throw new Error(`${filename}: ${assignment.key} (${reformers.join(' + ') || 'base'}) is no longer present in ${assignment.section}`);
    }
    if (assignment.clear) continue;
    let target = parsed.bindings.find((item) => item.section === assignment.section && item.command === assignment.command);
    if (!target) {
      target = { section: assignment.section, command: assignment.command, name: assignment.name, added: [], removed: [] };
      parsed.bindings.push(target);
    }
    target.name = assignment.name;
    target.removed = target.removed.filter((input) => input.key !== assignment.key || chordKey(input.reformers) !== chordKey(reformers));
    target.added.push({ key: assignment.key, reformers });
  }

  return serializeDcsProfile(parsed);
}

function serializeDcsProfile(parsed) {
  const sections = ['keyDiffs', 'axisDiffs'].map((section) => {
    const entries = parsed.bindings
      .filter((binding) => binding.section === section && (binding.added.length > 0 || binding.removed.length > 0))
      .map((binding) => `    [${luaString(binding.command)}] = {\n${serializeInputs('added', binding.added)}${serializeInputs('removed', binding.removed)}      ["name"] = ${luaString(binding.name)},\n    },`);
    return entries.length ? `  ["${section}"] = {\n${entries.join('\n')}\n  },` : '';
  }).filter(Boolean);
  return `local diff = {\n${sections.join('\n')}\n}\nreturn diff\n`;
}

function normalizeLegacyChordCommandBindings(parsed) {
  let changed = false;
  for (const binding of [...parsed.bindings]) {
    const inputs = [...binding.added, ...binding.removed];
    if (inputs.length === 0) continue;
    const suffixes = [...new Set(inputs.flatMap((input) => input.reformers ?? []))]
      .filter((reformer) => reformer && binding.command.endsWith(reformer))
      .sort((left, right) => right.length - left.length);
    const reformer = suffixes.find((candidate) => inputs.every((input) => input.reformers?.includes(candidate)));
    if (!reformer) continue;
    const canonicalCommand = binding.command.slice(0, -reformer.length);
    const target = parsed.bindings.find((candidate) => candidate !== binding &&
      candidate.section === binding.section && candidate.command === canonicalCommand);
    if (!target) continue;

    const location = (input) => `${input.key}\0${chordKey(input.reformers)}`;
    for (const input of binding.added)
      if (!target.added.some((candidate) => location(candidate) === location(input))) target.added.push(input);
    for (const input of binding.removed)
      if (!target.removed.some((candidate) => location(candidate) === location(input))) target.removed.push(input);
    parsed.bindings.splice(parsed.bindings.indexOf(binding), 1);
    changed = true;
  }
  return changed;
}

export function canonicalizeLegacyChordCommandIds(source, { filename = 'profile.diff.lua' } = {}) {
  const parsed = parseDcsDiffLua(source, { filename });
  return normalizeLegacyChordCommandBindings(parsed) ? serializeDcsProfile(parsed) : source;
}

export function mergeRepositoryAssignments(observedSource, repositorySource, { filename = 'profile.diff.lua' } = {}) {
  const observed = parseDcsDiffLua(observedSource, { filename });
  const repository = parseDcsDiffLua(repositorySource, { filename });
  normalizeLegacyChordCommandBindings(observed);
  normalizeLegacyChordCommandBindings(repository);
  const location = (input) => `${input.key}\0${chordKey(input.reformers)}`;
  const repositoryLocations = new Set(repository.bindings.flatMap((binding) => [...binding.added, ...binding.removed].map(location)));
  for (const binding of observed.bindings)
    binding.added = binding.added.filter((input) => !repositoryLocations.has(location(input)));
  for (const saved of repository.bindings) {
    let target = observed.bindings.find((binding) => binding.section === saved.section && binding.command === saved.command);
    if (!target) {
      target = { section: saved.section, command: saved.command, name: saved.name, added: [], removed: [] };
      observed.bindings.push(target);
    }
    target.name = saved.name;
    for (const input of saved.added)
      if (!target.added.some((candidate) => location(candidate) === location(input))) target.added.push(input);
    for (const input of saved.removed)
      if (!target.removed.some((candidate) => location(candidate) === location(input))) target.removed.push(input);
  }
  return serializeDcsProfile(observed);
}

function effectiveProfileSource(profilesDir, repositoryProfilesDir, fileName) {
  const observed = readFileSync(join(profilesDir, fileName), 'utf8');
  const repository = repositoryProfilesDir ? join(repositoryProfilesDir, fileName) : null;
  return repository && existsSync(repository)
    ? mergeRepositoryAssignments(observed, readFileSync(repository, 'utf8'), { filename: fileName })
    : canonicalizeLegacyChordCommandIds(observed, { filename: fileName });
}

function previewWithAssignments(preview, assignments, commonRoot) {
  if (!assignments?.length) return preview;
  let rows = preview.rows.map((row) => ({ ...row }));
  for (const assignment of assignments) {
    const matches = (row) => row.profileFile === assignment.profileFile && row.section === assignment.section &&
      row.key === assignment.key && chordKey(row.reformers) === chordKey(assignment.reformers);
    let index = rows.findIndex(matches);
    if (assignment.clear) { rows = rows.filter((row) => !matches(row)); continue; }
    if (index < 0 && assignment.allowCreate) {
      const device = preview.devices.find((item) => item.profileFile === assignment.profileFile);
      if (!device) throw new Error('Assignment device is not in the preview');
      const catalog = loadCalloutCatalog(commonRoot, device.deviceId);
      const catalogKey = resolveCatalogInputKey(device.deviceId, assignment.key, loadDeviceMap(commonRoot));
      const control = catalog.controls.find((item) => item.key === catalogKey && (item.type === 'axis' ? 'axisDiffs' : 'keyDiffs') === assignment.section);
      if (!control) throw new Error('Assignment target is not in the hardware catalog');
      const reformers = assignment.reformers ?? [];
      if (reformers.some((name) => !preview.modifiers.some((modifier) => modifier.name === name)))
        throw new Error('Assignment uses an unknown modifier');
      const semantic = reformers.map((name) => preview.modifiers.find((modifier) => modifier.name === name)?.semanticModifier ?? name);
      rows.push({ ...device, key: assignment.key, section: assignment.section, reformers, chord: chordKey(reformers),
        semanticChord: chordKey(semantic), calloutId: device.deviceId === 'tm-mfd' && reformers.length && control.id.startsWith('mfd-osb-') ? `${control.id}-shifted` : control.id,
        deviceLabel: control.hardwareLabel, status: 'OK' });
      index = rows.length - 1;
    }
    if (index < 0) throw new Error('Assignment target is no longer in the preview');
    const row = rows[index];
    const updated = {
      ...row,
      isUnboundCandidate: false,
      command: assignment.command,
      name: assignment.name,
      defaultLabel: assignment.name,
      label: assignment.name,
      labelSource: 'dcs',
    };
    updated.bindingId = stableBindingId(updated);
    const overrides = preview.labelsPath ? JSON.parse(readFileSync(preview.labelsPath, 'utf8')) : {};
    if (Object.hasOwn(overrides, updated.bindingId)) { updated.label = String(overrides[updated.bindingId]); updated.labelSource = 'user'; }
    rows = rows.filter((candidate, candidateIndex) => candidateIndex === index || !matches(candidate));
    rows[index] = updated;
  }
  return { ...preview, rows };
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
  if (device.profileKey) return device.profileKey;
  const base = device.deviceId ?? slugifyId(device.stem || 'device').toLowerCase();
  if (device.instanceHint) return `${base}-${device.instanceHint}`;
  return base;
}

function normalizedRole(value) {
  return slugifyId(value).toLowerCase();
}

export function assignDeviceInstances(devices, rows, roleOverrides = {}, errors = []) {
  const normalizedRoleOverrides = new Map(
    Object.entries(roleOverrides).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const groups = new Map();
  for (const device of devices) {
    if (!device.deviceId) continue;
    if (!groups.has(device.deviceId)) groups.set(device.deviceId, []);
    groups.get(device.deviceId).push(device);
  }

  const usedProfileKeys = new Map();
  for (const [deviceId, group] of groups) {
    const repeated = group.length > 1;
    for (const device of group) {
      const guid = extractProfileGuid(device.profileFile);
      const physicalInstance = guid ?? device.profileFile;
      const requestedRole =
        normalizedRoleOverrides.get(device.profileFile.toLowerCase()) ??
        (guid ? normalizedRoleOverrides.get(guid) : null) ??
        null;
      const role = requestedRole ? normalizedRole(requestedRole) : null;
      const profileKey = requestedRole
        ? `${deviceId}-${role}`
        : device.instanceHint
          ? `${deviceId}-${normalizedRole(device.instanceHint)}`
          : repeated
            ? `${deviceId}-${guid ?? normalizedRole(device.profileFile)}`
            : deviceId;

      if (!role && requestedRole !== null) {
        errors.push(`${device.profileFile}: instance role must contain at least one letter or number`);
      }
      const previous = usedProfileKeys.get(profileKey);
      if (previous) {
        errors.push(
          `${device.profileFile}: generated profile key '${profileKey}' conflicts with ${previous}; assign unique instance roles`,
        );
      } else {
        usedProfileKeys.set(profileKey, device.profileFile);
      }

      Object.assign(device, {
        guid,
        physicalInstance,
        role,
        profileKey,
        repeatedDevice: repeated,
      });
      for (const row of rows) {
        if (row.profileFile !== device.profileFile) continue;
        Object.assign(row, {
          guid,
          physicalInstance,
          role,
          profileKey,
        });
      }
    }
  }
}

export function buildPreview({ profilesDir, repositoryProfilesDir = null, modifiersPath = null, mapPath = null, rolesPath = null, semanticModifiersPath = null, labelsPath = null, mfdCategoriesPath = null, pagePresentationPath = null, mozaGrip = null, commonRoot = defaultCommonRoot }) {
  if (!profilesDir || !existsSync(profilesDir) || !statSync(profilesDir).isDirectory()) {
    throw new Error(`profiles directory not found: ${profilesDir}`);
  }
  const deviceMap = loadDeviceMap(commonRoot);
  const knownIds = loadManifestDeviceIds(commonRoot);
  const overrides = mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};
  const roleOverrides = rolesPath ? JSON.parse(readFileSync(rolesPath, 'utf8')) : {};
  const semanticOverrides = semanticModifiersPath ? JSON.parse(readFileSync(semanticModifiersPath, 'utf8')) : {};
  const labelOverrides = labelsPath ? JSON.parse(readFileSync(labelsPath, 'utf8')) : {};
  const mfdCategoryOverrides = mfdCategoriesPath ? JSON.parse(readFileSync(mfdCategoriesPath, 'utf8')) : {};
  const pagePresentationOverrides = pagePresentationPath ? JSON.parse(readFileSync(pagePresentationPath, 'utf8')) : {};

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
  for (const modifier of modifiers) {
    modifier.semanticModifier = semanticOverrides[modifier.name]
      ?? semanticOverrides[`${modifier.device}\0${modifier.key}`]
      ?? modifier.name;
  }

  const profileFiles = readdirSync(profilesDir)
    .filter((name) => name.toLowerCase().endsWith('.diff.lua'))
    .sort((left, right) => left.localeCompare(right));

  const devices = [];
  const rows = [];
  const availableControls = [];
  const errors = [...modifierErrors];
  const reportedUnknownModifiers = new Set();
  const catalogCache = new Map();

  for (const fileName of profileFiles) {
    const mapping = resolveDeviceMapping(fileName, deviceMap, overrides);
    if (mapping.deviceId === 'moza-ab9' && mapping.source === 'standalone-fallback' && mozaGrip) {
      const selectedDeviceId = {
        standalone: 'moza-ab9',
        viper: 'moza-ab9-warthog-grip',
        hornet: 'moza-ab9-hornet-grip',
      }[mozaGrip];
      if (!selectedDeviceId) throw new Error('mozaGrip must be standalone, viper, or hornet');
      mapping.deviceId = selectedDeviceId;
      mapping.source = mozaGrip === 'standalone' ? 'standalone-fallback' : 'ui-selection';
    }
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
      bindings = parseDcsDiffLua(effectiveProfileSource(profilesDir, repositoryProfilesDir, fileName), { filename: fileName }).bindings;
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
        const unknownModifiers = reformers.filter((name) => !modifierByName.has(name));
        const modifierModes = reformers.map((name) => modifierByName.get(name)?.mode ?? null);
        const catalogKey = resolveCatalogInputKey(mapping.deviceId, input.key, deviceMap);
        const calloutIds = catalog.byKey.get(catalogKey) ?? [];
        let status = 'OK';
        if (!mapping.deviceId) status = 'Unmapped device';
        else if (calloutIds.length === 0) status = 'No callout';
        if (unknownModifiers.length > 0) {
          status = status === 'OK' ? 'Unknown modifier' : `${status}; Unknown modifier`;
          for (const name of unknownModifiers) {
            const errorKey = `${fileName}\0${name}`;
            if (reportedUnknownModifiers.has(errorKey)) continue;
            reportedUnknownModifiers.add(errorKey);
            const source = modifiersPath ? basename(modifiersPath) : 'modifiers.lua';
            errors.push(
              `${fileName}: modifier '${name}' is referenced by a profile binding but is not declared in ${source}`,
            );
          }
        }

        const sameChordCommands = bindings.filter((candidate) =>
          candidate.added.some(
            (entry) => entry.key === input.key && chordKey(entry.reformers) === chordKey(reformers),
          ),
        );
        if (sameChordCommands.length > 1) status = status === 'OK' ? 'Ambiguous' : `${status}; Ambiguous`;

        const row = {
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
          catalogKey,
          reformers,
          chord: chordKey(reformers),
          modifierModes,
          unknownModifiers,
          calloutId: reformers.length > 0 && mapping.deviceId === 'tm-mfd' && calloutIds[0]?.startsWith('mfd-osb-')
            ? `${calloutIds[0]}-shifted`
            : calloutIds[0] ?? null,
          calloutIds,
          status,
        };
        row.semanticChord = chordKey(reformers.map((name) => modifierByName.get(name)?.semanticModifier ?? name));
        row.defaultLabel = binding.name ?? binding.command ?? '';
        row.deviceLabel = calloutIds[0] ? catalog.labelById.get(calloutIds[0]) ?? '' : '';
        row.bindingId = stableBindingId(row);
        if (Object.prototype.hasOwnProperty.call(labelOverrides, row.bindingId)) {
          row.label = String(labelOverrides[row.bindingId]);
          row.labelSource = 'user';
        } else {
          row.label = row.defaultLabel;
          row.labelSource = 'dcs';
        }
        rows.push(row);
      }
    }

    const chordChoices = [[], ...modifiers.map((modifier) => [modifier.name])];
    const catalogControls = [...new Map(catalog.controls.map((control) =>
      [`${control.type}\0${control.key}`, control])).values()];
    for (const control of catalogControls) {
      const section = control.type === 'axis' ? 'axisDiffs' : 'keyDiffs';
      for (const reformers of chordChoices) {
        if (rows.some((row) => row.profileFile === fileName && row.section === section &&
            row.catalogKey === control.key && chordKey(row.reformers) === chordKey(reformers))) continue;
        const row = {
          profileFile: fileName,
          stem: mapping.stem,
          deviceId: mapping.deviceId,
          mappingSource: mapping.source,
          matchedPattern: mapping.matchedPattern,
          instanceHint,
          section,
          command: null,
          name: null,
          key: control.key,
          catalogKey: control.key,
          reformers,
          chord: chordKey(reformers),
          modifierModes: reformers.map((name) => modifierByName.get(name)?.mode ?? null),
          unknownModifiers: [],
          calloutId: reformers.length > 0 && mapping.deviceId === 'tm-mfd' && control.id.startsWith('mfd-osb-')
            ? `${control.id}-shifted` : control.id,
          calloutIds: [control.id],
          status: 'Unbound',
          semanticChord: chordKey(reformers.map((name) => modifierByName.get(name)?.semanticModifier ?? name)),
          defaultLabel: '',
          deviceLabel: control.hardwareLabel ?? '',
          label: control.hardwareLabel ?? '',
          labelSource: 'device',
          isUnboundCandidate: true,
        };
        row.bindingId = stableBindingId(row);
        availableControls.push(row);
      }
    }
  }

  assignDeviceInstances(devices, [...rows, ...availableControls], roleOverrides, errors);

  for (const device of devices) {
    const configured = pagePresentationOverrides[device.profileKey] ?? pagePresentationOverrides[device.profileFile];
    if (configured === undefined) continue;
    if (!configured || Array.isArray(configured) || typeof configured !== 'object') {
      errors.push(`${device.profileFile}: page presentation must be an object`);
      continue;
    }
    if (configured.title !== undefined && typeof configured.title !== 'string') {
      errors.push(`${device.profileFile}: page title must be a string`);
      continue;
    }
    if (configured.kicker !== undefined && typeof configured.kicker !== 'string') {
      errors.push(`${device.profileFile}: page kicker must be a string`);
      continue;
    }
    device.pageTitle = configured.title;
    device.pageKicker = configured.kicker;
  }

  const categorySides = new Set(['top', 'right', 'bottom', 'left']);
  for (const device of devices.filter(({ deviceId }) => deviceId === 'tm-mfd')) {
    const configured = mfdCategoryOverrides[device.profileKey] ?? mfdCategoryOverrides[device.profileFile];
    if (configured === undefined) continue;
    if (!configured || Array.isArray(configured) || typeof configured !== 'object') {
      errors.push(`${device.profileFile}: MFD categories must be an object`);
      continue;
    }
    const unknown = Object.keys(configured).filter((side) => !categorySides.has(side));
    if (unknown.length > 0) {
      errors.push(`${device.profileFile}: unknown MFD category side(s): ${unknown.join(', ')}`);
      continue;
    }
    const invalid = Object.entries(configured).find(([, value]) => typeof value !== 'string');
    if (invalid) {
      errors.push(`${device.profileFile}: MFD category ${invalid[0]} must be a string`);
      continue;
    }
    device.categoryLabels = { ...configured };
  }

  for (const modifier of modifiers) {
    const modifierGuid = modifier.device.match(/\{([0-9A-Fa-f-]{36})\}\s*$/u)?.[1]?.toLowerCase() ?? null;
    const modifierStem = normalizedPhysicalDevice(modifier.device);
    const device = devices.find((candidate) =>
      (modifierGuid && candidate.guid === modifierGuid) || normalizedPhysicalDevice(candidate.stem) === modifierStem);
    if (!device?.deviceId) continue;
    const catalog = catalogCache.get(device.deviceId) ?? loadCalloutCatalog(commonRoot, device.deviceId);
    const catalogKey = resolveCatalogInputKey(device.deviceId, modifier.key, deviceMap);
    Object.assign(modifier, {
      profileFile: device.profileFile,
      profileKey: device.profileKey,
      deviceId: device.deviceId,
      calloutId: catalog.byKey.get(catalogKey)?.[0] ?? null,
    });
  }

  return {
    schemaVersion: 2,
    generatedBy: 'scaffold-consumer.mjs',
    mode: 'preview',
    commonRoot,
    profilesDir: resolve(profilesDir),
    repositoryProfilesDir: repositoryProfilesDir ? resolve(repositoryProfilesDir) : null,
    modifiersPath: modifiersPath ? resolve(modifiersPath) : null,
    mapPath: mapPath ? resolve(mapPath) : null,
    rolesPath: rolesPath ? resolve(rolesPath) : null,
    semanticModifiersPath: semanticModifiersPath ? resolve(semanticModifiersPath) : null,
    labelsPath: labelsPath ? resolve(labelsPath) : null,
    mfdCategoriesPath: mfdCategoriesPath ? resolve(mfdCategoriesPath) : null,
    pagePresentationPath: pagePresentationPath ? resolve(pagePresentationPath) : null,
    mozaGrip,
    modifiers: modifiers.map(({ name, device, key, mode, semanticModifier, profileFile, profileKey, deviceId, calloutId }) =>
      ({ name, device, key, mode, semanticModifier, profileFile, profileKey, deviceId, calloutId })),
    semanticModifiers: [...new Set(modifiers.map(({ semanticModifier }) => semanticModifier))].sort(),
    devices,
    rows,
    availableControls,
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
export function buildDraftKneeboardConfig(preview, { displayName, inputModuleId, includeUiLayer = true }) {
  const profiles = {};
  const canonicalLabels = {};
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
      semanticModifier: mod.semanticModifier,
      deviceId: mod.deviceId,
    };
  }

  const pagesByDevice = new Map();
  let pageIndex = 1;
  for (const device of preview.devices) {
    if (!device.deviceId) continue;
    const profileKey = profileKeyFromDevice(device);
    const inferredTitle = device.role ? `${device.stem || device.deviceId} — ${device.role}` : device.stem || device.deviceId;
    const title = device.pageTitle ?? inferredTitle;
    const file = `${String(pageIndex).padStart(2, '0')}-${slugifyId(profileKey).toUpperCase()}`;
    pageIndex += 1;

    const controls = {};
    const labels = {};
    const modifierCallouts = {};
    const layerControls = new Map();

    for (const row of preview.rows) {
      if (row.profileFile !== device.profileFile) continue;
      if (!row.calloutId || row.unknownModifiers?.length) continue;
      // Include keyDiffs and axisDiffs so throttle/stick/rudder axes are scaffolded.

      const effectiveLabel = row.label ?? row.defaultLabel ?? row.deviceLabel ?? '';
      const labelId = `binding-${createHash('sha256').update(row.bindingId).digest('hex').slice(0, 16)}`;
      canonicalLabels[labelId] = effectiveLabel;
      const reference = { profile: profileKey, key: row.key, command: row.command, labelId };

      if (!row.chord) {
        if (!controls[row.calloutId]) {
          controls[row.calloutId] = reference;
        }
      } else {
        const layerId = row.semanticChord || row.chord;
        if (!layerControls.has(layerId)) {
          layerControls.set(layerId, { controls: {}, nativeChords: new Set() });
        }
        const layer = layerControls.get(layerId);
        layer.nativeChords.add(row.chord);
        reference.modifiers = row.reformers.map((native) => {
          const found = Object.entries(modifiers).find(([, value]) => value.nativeName === native);
          return found?.[0] ?? aliasFromModifierName(native);
        });
        if (!layer.controls[row.calloutId]) {
          layer.controls[row.calloutId] = reference;
        } else {
          const existing = Array.isArray(layer.controls[row.calloutId])
            ? layer.controls[row.calloutId]
            : [layer.controls[row.calloutId]];
          existing.push(reference);
          layer.controls[row.calloutId] = existing;
        }
      }
    }

    for (const modifier of preview.modifiers) {
      if (modifier.profileFile !== device.profileFile || !modifier.calloutId) continue;
      const alias = aliasFromModifierName(modifier.name);
      labels[modifier.calloutId] = 'SHIFT / MODIFIER';
      modifierCallouts[modifier.calloutId] = alias;
    }

    const page = {
      file,
      profile: profileKey,
      includeUiLayer,
      deviceId: device.deviceId,
      deviceInstance: device.instanceHint
        ? (device.deviceId === 'tm-mfd' ? `MFD${device.instanceHint}` : String(device.instanceHint))
        : null,
      title,
      kicker: device.pageKicker ?? (device.role ? `ROLE ${device.role.toUpperCase()}` : device.instanceHint ? `INSTANCE ${device.instanceHint}` : 'SCAFFOLD DRAFT'),
      _comment:
        'binding labels are stored once in the root labels dictionary; page labels are reserved for non-binding callouts. ' +
        'keep callout IDs in sync with controls.',
      modifierCallouts,
    };
    if (Object.keys(labels).length > 0) page.labels = labels;
    if (device.deviceId === 'tm-mfd' && device.categoryLabels) {
      page.categoryLabels = { ...device.categoryLabels };
    }

    if (layerControls.size === 0) {
      page.controls = controls;
    } else {
      const layers = [
        { id: 'base', controls },
      ];
      for (const [semanticChord, layerMap] of layerControls) {
        const nativeChords = [...layerMap.nativeChords].sort();
        layers.push({
          id: semanticChord || 'layer',
          file: `${file}-${slugifyId(semanticChord) || 'LAYER'}`,
          title: `${title} • ${semanticChord}`,
          activators: nativeChords,
          controls: layerMap.controls,
        });
      }
      page.layers = layers;
    }

    pagesByDevice.set(profileKey, page);
  }

  const config = {
    schemaVersion: 1,
    aircraft: displayName,
    includeUiLayer: true,
    profiles,
    labels: canonicalLabels,
    pages: [...pagesByDevice.values()],
    semanticModifiers: Object.fromEntries(
      preview.semanticModifiers.map((id) => [id, preview.modifiers
        .filter((modifier) => modifier.semanticModifier === id)
        .map(({ name, device, key, mode }) => ({ nativeName: name, device, key, mode }))]),
    ),
  };

  if (Object.keys(modifiers).length > 0) {
    config.modifiersFile = `src/Config/Input/${inputModuleId}/modifiers.lua`;
    config.modifiers = modifiers;
  }

  return config;
}

function profileReferences(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) profileReferences(item, result);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'profile' && typeof item === 'string') result.add(item);
      else profileReferences(item, result);
    }
  }
  return result;
}

function modifierEntries(source) {
  const entries = new Map();
  const pattern = /\["([^"]+)"\]\s*=\s*\{([\s\S]*?)\n\s*\},?/gu;
  for (const match of source.matchAll(pattern)) entries.set(match[1], match[2].trim());
  return entries;
}

export function mergeModifierSources(existingSource, observedSource) {
  const existing = modifierEntries(existingSource);
  const observed = modifierEntries(observedSource);
  if (existing.size === 0 && observed.size === 0) return observedSource;
  for (const [name, body] of observed) existing.set(name, body);
  const lines = ['local modifiers = {'];
  for (const [name, body] of [...existing].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ["${name}"] = {`);
    lines.push(...body.split('\n').map((line) => `    ${line.trim()}`));
    lines.push('  },');
  }
  lines.push('}', 'return modifiers', '');
  return lines.join('\n');
}

function ensureMfdCategoryLabels(pages = []) {
  for (const page of pages) {
    if (page.deviceId !== 'tm-mfd') continue;
    const categories = page.categoryLabels ?? {};
    page.categoryLabels = {
      top: categories.top?.trim() || 'TOP',
      right: categories.right?.trim() || 'RIGHT',
      bottom: categories.bottom?.trim() || 'BOTTOM',
      left: categories.left?.trim() || 'LEFT',
    };
  }
}

export function mergeConsumerConfig(draft, existing, removedProfiles = []) {
  if (!existing || typeof existing !== 'object') {
    ensureMfdCategoryLabels(draft.pages);
    return { config: draft, preservedProfiles: [], removedProfiles: [] };
  }
  const removed = new Set(removedProfiles);
  const currentProfiles = new Set(Object.keys(draft.profiles ?? {}));
  const preservedProfiles = Object.keys(existing.profiles ?? {})
    .filter((profile) => !currentProfiles.has(profile) && !removed.has(profile));
  const config = { ...existing, ...draft };
  config.profiles = { ...(existing.profiles ?? {}), ...(draft.profiles ?? {}) };
  for (const profile of removed) delete config.profiles[profile];

  const currentPages = draft.pages ?? [];
  const pageIdentity = (page) => `${page?.deviceId ?? ''}|${page?.deviceInstance ?? ''}`.toLocaleLowerCase();
  const profileIdentity = (page) => page?.deviceInstance
    ? `${page?.deviceId ?? ''}-${String(page.deviceInstance).replace(/^MFD/iu, '')}`.toLocaleLowerCase()
    : String(page?.deviceId ?? '').toLocaleLowerCase();
  const currentPageIdentities = new Set(currentPages.map(pageIdentity));
  const existingPagesByIdentity = new Map((existing.pages ?? []).map((page) => [pageIdentity(page), page]));
  for (const page of currentPages) {
    const previous = existingPagesByIdentity.get(pageIdentity(page));
    if (!previous) continue;
    if (previous.title !== undefined) page.title = previous.title;
    if (previous.kicker !== undefined) page.kicker = previous.kicker;
    if (page.deviceId === 'tm-mfd' && page.categoryLabels === undefined && previous.categoryLabels !== undefined) {
      page.categoryLabels = { ...previous.categoryLabels };
    }
    if (Array.isArray(page.layers)) {
      const previousLayers = new Map((previous.layers ?? []).map((layer) => [layer.id, layer]));
      for (const layer of page.layers) {
        if (layer.id === 'base') continue;
        const previousLayer = previousLayers.get(layer.id);
        layer.title = previousLayer?.title ?? `${page.title} • ${layer.id}`;
      }
    }
  }
  const retainedPages = (existing.pages ?? []).filter((page) => {
    const references = profileReferences(page);
    if ([...references].some((profile) => removed.has(profile))) return false;
    if (removed.has(profileIdentity(page))) return false;
    if (references.size > 0) return [...references].every((profile) => !currentProfiles.has(profile));
    return !currentPageIdentities.has(pageIdentity(page));
  });
  config.pages = [...currentPages, ...retainedPages];
  ensureMfdCategoryLabels(config.pages);
  config.semanticModifiers = { ...(existing.semanticModifiers ?? {}), ...(draft.semanticModifiers ?? {}) };
  if (existing.modifiers || draft.modifiers) config.modifiers = { ...(existing.modifiers ?? {}), ...(draft.modifiers ?? {}) };
  if (!draft.modifiersFile && existing.modifiersFile) config.modifiersFile = existing.modifiersFile;
  return { config, preservedProfiles, removedProfiles: [...removed].filter((profile) => existing.profiles?.[profile]) };
}

export function writeConsumer({ preview, outputDir, displayName, inputModuleId, kneeboardId, repoName, removedProfiles = [], assignments = [], includeUiLayer = true, dryRun = false, commonRoot = defaultCommonRoot }) {
  const effectivePreview = previewWithAssignments(preview, assignments, commonRoot);
  if (assignments.some((assignment) => !preview.devices.some((device) => device.profileFile === assignment.profileFile)))
    throw new Error('Assignment profile is not in the preview');
  // Validate and materialize every changed profile before writing any destination files.
  const assignedProfiles = new Map();
  for (const device of preview.devices) {
    const pending = assignments.filter((assignment) => assignment.profileFile === device.profileFile);
    if (!pending.length) continue;
    assignedProfiles.set(device.profileFile, applyDcsCommandAssignments(
      effectiveProfileSource(preview.profilesDir, preview.repositoryProfilesDir, device.profileFile), pending, { filename: device.profileFile,
        allowedInputs: pending.filter((item) => item.allowCreate && effectivePreview.rows.some((row) => row.profileFile === item.profileFile && row.key === item.key && row.section === item.section)) }));
  }
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
    const pending = assignments.filter((assignment) => assignment.profileFile === device.profileFile);
    if (pending.length === 0) {
      const effective = effectiveProfileSource(preview.profilesDir, preview.repositoryProfilesDir, device.profileFile);
      if (!preview.repositoryProfilesDir && effective === readFileSync(source, 'utf8')) copy(source, `${joystickRel}/${device.profileFile}`);
      else write(`${joystickRel}/${device.profileFile}`, effective);
    }
    else write(`${joystickRel}/${device.profileFile}`, assignedProfiles.get(device.profileFile));
  }
  if (preview.modifiersPath && existsSync(preview.modifiersPath)) {
    const modifierRel = `src/Config/Input/${inputModuleId}/modifiers.lua`;
    const existingModifierPath = join(out, modifierRel);
    const observedModifiers = readFileSync(preview.modifiersPath, 'utf8');
    const mergedModifiers = existsSync(existingModifierPath)
      ? mergeModifierSources(readFileSync(existingModifierPath, 'utf8'), observedModifiers)
      : observedModifiers;
    write(modifierRel, mergedModifiers);
  }
  if (preview.mapPath && existsSync(preview.mapPath)) {
    copy(preview.mapPath, 'config/scaffold-device-overrides.json');
  }
  if (preview.rolesPath && existsSync(preview.rolesPath)) {
    copy(preview.rolesPath, 'config/scaffold-instance-roles.json');
  }

  const draftKneeboard = buildDraftKneeboardConfig(effectivePreview, { displayName, inputModuleId, includeUiLayer });
  const existingConfigPath = join(out, 'config/kneeboard.json');
  const existingKneeboard = existsSync(existingConfigPath) ? JSON.parse(readFileSync(existingConfigPath, 'utf8')) : null;
  const merge = mergeConsumerConfig(draftKneeboard, existingKneeboard, removedProfiles);
  const kneeboard = merge.config;
  write('config/kneeboard.json', JSON.stringify(kneeboard, null, 2));
  if (!dryRun) {
    for (const obsoleteConfig of [
      'scaffold-label-overrides.json',
      'scaffold-mfd-category-overrides.json',
      'scaffold-semantic-modifiers.json',
      'summary-pages.json',
    ]) {
      const obsoletePath = join(out, 'config', obsoleteConfig);
      if (existsSync(obsoletePath)) unlinkSync(obsoletePath);
    }
    for (const [profileKey, relative] of Object.entries(draftKneeboard.profiles ?? {})) {
      const previous = existingKneeboard?.profiles?.[profileKey];
      if (typeof previous !== 'string' || previous === relative) continue;
      const obsolete = join(out, previous);
      if (existsSync(obsolete)) unlinkSync(obsolete);
    }
    for (const profileKey of merge.removedProfiles) {
      const relative = existingKneeboard?.profiles?.[profileKey];
      if (typeof relative !== 'string') continue;
      const absolute = join(out, relative);
      if (existsSync(absolute)) unlinkSync(absolute);
    }
  }

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
    `- Preserved absent profiles: ${merge.preservedProfiles.length}`,
    `- Explicitly removed profiles: ${merge.removedProfiles.length}`,
    '',
    '## Devices',
    '',
    ...preview.devices.map(
      (d) =>
        `- \`${d.profileFile}\` → profile \`${d.profileKey ?? '**UNMAPPED**'}\` → ${d.deviceId ?? '**UNMAPPED**'} (${d.mappingSource}${d.role ? `, role ${d.role}` : ''}${d.guid ? `, GUID ${d.guid}` : ''}${d.mappingSource === 'standalone-fallback' ? '; generic AB9 profile—select the installed grip' : ''})`,
    ),
    ...merge.preservedProfiles.map((profile) => `- \`${profile}\` → preserved while absent from this scaffold session`),
    ...merge.removedProfiles.map((profile) => `- \`${profile}\` → explicitly removed`),
    '',
    '## TM MFD categories',
    '',
    ...preview.devices.filter((device) => device.deviceId === 'tm-mfd').map((device) => {
      const categories = device.categoryLabels ?? {};
      const text = ['top', 'right', 'bottom', 'left'].map((side) => `${side}=${categories[side] ?? ''}`).join('; ');
      return `- \`${device.profileKey}\`: ${text}`;
    }),
    '',
    '## Bindings',
    '',
    '| Device | Control | DCS command name | Device label | Effective label | Label source |',
    '| --- | --- | --- | --- | --- | --- |',
    ...preview.rows.map((row) => {
      const cell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
      return `| ${cell(row.stem)} | ${cell(row.key)} | ${cell(row.name)} | ${cell(row.deviceLabel)} | ${cell(row.label)} | ${cell(row.labelSource)} |`;
    }),
    '',
    '## Next steps',
    '',
    '1. Review `config/kneeboard.json` (draft controls/layers).',
    '2. Review each profile-driven `controls` entry’s `label`, initialized from the imported DCS command name. Page-level `labels` are reserved for non-binding callouts.',
    '3. Review repeated-device roles. Supply `--roles` to replace GUID-backed defaults with semantic names such as left-tank-control.',
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
    repositoryProfilesDir: options.repositoryProfilesDir ?? (options.outputDir && options.inputModuleId
      ? join(options.outputDir, 'src', 'Config', 'Input', options.inputModuleId, 'joystick') : null),
    modifiersPath: options.modifiersPath,
    mapPath: options.mapPath,
    rolesPath: options.rolesPath,
    semanticModifiersPath: options.semanticModifiersPath,
    labelsPath: options.labelsPath,
    mfdCategoriesPath: options.mfdCategoriesPath,
    pagePresentationPath: options.pagePresentationPath,
    mozaGrip: options.mozaGrip,
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
      removedProfiles: options.removeProfilesPath ? JSON.parse(readFileSync(options.removeProfilesPath, 'utf8')) : [],
      assignments: options.assignmentsPath ? JSON.parse(readFileSync(options.assignmentsPath, 'utf8')) : [],
      includeUiLayer: options.includeUiLayer,
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
