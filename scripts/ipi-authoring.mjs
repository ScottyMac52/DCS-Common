#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPreview, writeConsumer } from './scaffold-consumer.mjs';
import { serializeModifiers } from './manage-ui-layer-catalog.mjs';
import { normalizeUiLayerUtilization } from './ui-layer-utilization.mjs';
import { parseDcsModifiersLua } from './profile-driven-kneeboard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertRepositoryRoot(repositoryRoot) {
  const normalized = resolve(repositoryRoot);
  const blocked = normalized.split(/[\\/]/u).some((part) => part === '.dcs-common' || part === 'dist' || /^stage-/u.test(part));
  if (blocked) throw new Error('IPI authoring refuses generated .dcs-common, dist, and stage destinations.');
  if (!existsSync(normalized)) throw new Error(`Repository root does not exist: ${normalized}`);
  return normalized;
}

function cleanFilename(value) {
  if (typeof value !== 'string' || !value.endsWith('.diff.lua') || basename(value) !== value || value.includes('..')) {
    throw new Error('profileFilename must be a plain .diff.lua filename.');
  }
  return value;
}

export function initializeBlankConsumer(request) {
  const commonRoot = resolve(request.commonRoot ?? root);
  const repositoryRoot = assertRepositoryRoot(request.repositoryRoot);
  for (const name of ['displayName', 'inputModuleId', 'kneeboardId']) {
    if (typeof request[name] !== 'string' || !request[name].trim()) throw new Error(`${name} is required.`);
  }
  if (!request.deviceId) throw new Error('deviceId is required.');
  const profileFilename = cleanFilename(request.profileFilename);
  const temporary = mkdtempSync(join(tmpdir(), 'ipi-blank-authoring-'));
  try {
    const profiles = join(temporary, 'profiles');
    mkdirSync(profiles, { recursive: true });
    writeFileSync(join(profiles, profileFilename), 'local diff = {\n}\nreturn diff\n', 'utf8');
    const mapPath = join(temporary, 'devices.json');
    writeFileSync(mapPath, JSON.stringify({ [profileFilename]: request.deviceId }), 'utf8');
    let modifiersPath = null;
    if (request.modifiers?.length) {
      modifiersPath = join(temporary, 'modifiers.lua');
      writeFileSync(modifiersPath, serializeModifiers(request.modifiers), 'utf8');
    }
    const rolesPath = request.deviceInstance ? join(temporary, 'roles.json') : null;
    if (rolesPath) writeFileSync(rolesPath, JSON.stringify({ [profileFilename]: request.deviceInstance }), 'utf8');
    const preview = buildPreview({ profilesDir: profiles, modifiersPath, mapPath, rolesPath, commonRoot });
    if (preview.errors.length) throw new Error(preview.errors.join('\n'));
    const result = writeConsumer({ preview, outputDir: repositoryRoot, displayName: request.displayName.trim(),
      inputModuleId: request.inputModuleId.trim(), kneeboardId: request.kneeboardId.trim(),
      repoName: request.repoName, assignments: request.assignments ?? [], commonRoot });
    if (request.uiLayerUtilization) {
      const configPath = join(repositoryRoot, 'config', 'kneeboard.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.uiLayerUtilization = normalizeUiLayerUtilization(request.uiLayerUtilization);
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    }
    return { ...result, profilesDirectory: join(repositoryRoot, 'src', 'Config', 'Input', request.inputModuleId, 'joystick'),
      rebuild: { importerExe: false, consumerRescaffold: false, kneeboards: true, ovgmePackage: true } };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function moduleFiles(repositoryRoot, moduleId) {
  return [join(repositoryRoot, 'config', 'kneeboard.json'), join(repositoryRoot, 'src', 'Config', 'Input', moduleId, 'modifiers.lua')];
}

export function moduleAuthoringFingerprint(repositoryRootArg, moduleId) {
  const repositoryRoot = assertRepositoryRoot(repositoryRootArg);
  return sha256(moduleFiles(repositoryRoot, moduleId).filter(existsSync)
    .map((path) => `${path.slice(repositoryRoot.length + 1)}\0${sha256(readFileSync(path))}`).join('\n'));
}

export function inspectModuleAuthoring(repositoryRootArg, moduleId) {
  const repositoryRoot = assertRepositoryRoot(repositoryRootArg);
  const configPath = join(repositoryRoot, 'config', 'kneeboard.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
  const modifierPath = join(repositoryRoot, 'src', 'Config', 'Input', moduleId, 'modifiers.lua');
  const modifiers = existsSync(modifierPath)
    ? parseDcsModifiersLua(readFileSync(modifierPath, 'utf8'), { filename: modifierPath }).modifiers
    : [];
  const semanticByNative = new Map(Object.entries(config?.modifiers ?? {}).map(([id, value]) =>
    [value.nativeName ?? id, { semanticModifier: value.semanticModifier ?? id, deviceId: value.deviceId ?? null }]));
  return { repositoryRoot, inputModuleId: moduleId, fingerprint: moduleAuthoringFingerprint(repositoryRoot, moduleId),
    initialized: config !== null, modifiers: modifiers.map((item) => ({ ...item, ...(semanticByNative.get(item.name) ?? {}) })),
    uiLayerUtilization: config?.uiLayerUtilization ?? null };
}

export function saveModuleAuthoring(request) {
  const repositoryRoot = assertRepositoryRoot(request.repositoryRoot);
  if (!request.inputModuleId) throw new Error('inputModuleId is required.');
  const before = moduleAuthoringFingerprint(repositoryRoot, request.inputModuleId);
  if (request.expectedFingerprint && request.expectedFingerprint !== before) {
    throw new Error(`Stale module authoring state: expected ${request.expectedFingerprint}, found ${before}. Reload before saving.`);
  }
  const configPath = join(repositoryRoot, 'config', 'kneeboard.json');
  if (!existsSync(configPath)) throw new Error('config/kneeboard.json does not exist. Initialize the blank clone first.');
  const modifierPath = join(repositoryRoot, 'src', 'Config', 'Input', request.inputModuleId, 'modifiers.lua');
  const stagedConfig = `${configPath}.ipi-${randomUUID()}`;
  const stagedModifiers = `${modifierPath}.ipi-${randomUUID()}`;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (request.uiLayerUtilization !== undefined) config.uiLayerUtilization = normalizeUiLayerUtilization(request.uiLayerUtilization);
    if (request.modifiers !== undefined) {
      const modifiers = request.modifiers;
      config.modifiersFile = `src/Config/Input/${request.inputModuleId}/modifiers.lua`;
      config.modifiers = Object.fromEntries(modifiers.map((modifier) => [modifier.name, {
        nativeName: modifier.name, mode: modifier.mode, semanticModifier: modifier.semanticModifier ?? modifier.name,
        deviceId: modifier.deviceId ?? null,
      }]));
      config.semanticModifiers = Object.fromEntries([...new Set(modifiers.map((modifier) => modifier.semanticModifier ?? modifier.name))]
        .map((semantic) => [semantic, modifiers.filter((modifier) => (modifier.semanticModifier ?? modifier.name) === semantic)
          .map(({ name, device, key, mode }) => ({ nativeName: name, device, key, mode }))]));
      mkdirSync(dirname(modifierPath), { recursive: true });
      writeFileSync(stagedModifiers, serializeModifiers(modifiers), 'utf8');
    }
    writeFileSync(stagedConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const replacements = [[stagedModifiers, modifierPath], [stagedConfig, configPath]].filter(([stage]) => existsSync(stage))
      .map(([stage, live]) => ({ stage, live, backup: `${live}.ipi-backup-${randomUUID()}`, hadLive: existsSync(live) }));
    try {
      for (const item of replacements) if (item.hadLive) renameSync(item.live, item.backup);
      for (const item of replacements) renameSync(item.stage, item.live);
    } catch (error) {
      for (const item of replacements) {
        if (existsSync(item.live)) rmSync(item.live, { force: true });
        if (existsSync(item.backup)) renameSync(item.backup, item.live);
      }
      throw error;
    }
    for (const item of replacements) if (existsSync(item.backup)) rmSync(item.backup, { force: true });
    return { fingerprint: moduleAuthoringFingerprint(repositoryRoot, request.inputModuleId),
      changedFiles: [request.modifiers !== undefined ? `src/Config/Input/${request.inputModuleId}/modifiers.lua` : null,
        'config/kneeboard.json'].filter(Boolean), rebuild: { importerExe: false, kneeboards: true, ovgmePackage: true } };
  } finally {
    rmSync(stagedConfig, { force: true });
    rmSync(stagedModifiers, { force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, requestPath] = argv;
  if (!command || !requestPath) throw new Error('Usage: ipi-authoring.mjs initialize|inspect-module|save-module <request.json>');
  const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
  if (command === 'initialize') console.log(JSON.stringify(initializeBlankConsumer(request)));
  else if (command === 'inspect-module') console.log(JSON.stringify(inspectModuleAuthoring(request.repositoryRoot, request.inputModuleId)));
  else if (command === 'save-module') console.log(JSON.stringify(saveModuleAuthoring(request)));
  else throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message ?? error); process.exitCode = 1; }
}
