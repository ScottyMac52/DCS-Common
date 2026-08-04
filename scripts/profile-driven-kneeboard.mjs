import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadSharedHardware, resolveDcsCommonRoot } from './shared-hardware-consumer.mjs';

function unescapeLuaString(value) {
  return value.replace(/\\([\\"nrt])/g, (_, code) => ({ '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' })[code]);
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

function tableBody(source, name) {
  const marker = `["${name}"]`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) throw new Error(`${name} is not a Lua table.`);
  return source.slice(open + 1, matchingBrace(source, open));
}

function rootTableBody(source, variable, filename) {
  const declaration = new RegExp(`\\blocal\\s+${variable}\\s*=\\s*\\{`).exec(source);
  if (!declaration) throw new Error(`${filename} must declare local ${variable}.`);
  const open = source.indexOf('{', declaration.index);
  return source.slice(open + 1, matchingBrace(source, open));
}

function topLevelEntries(body) {
  const entries = [];
  const pattern = /\["((?:\\.|[^"])*)"\]\s*=\s*\{/g;
  for (let match; (match = pattern.exec(body));) {
    const prefix = body.slice(0, match.index);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (const char of prefix) {
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
    entries.push({ command: unescapeLuaString(match[1]), body: body.slice(open + 1, close) });
    pattern.lastIndex = close + 1;
  }
  return entries;
}

function listInputs(entryBody, listName) {
  const actual = tableBody(entryBody, listName);
  if (!actual) return [];
  return [...actual.matchAll(/\["key"\]\s*=\s*"((?:\\.|[^"])*)"([\s\S]*?)(?=\["key"\]|$)/g)].map((match) => ({
    key: unescapeLuaString(match[1]),
    reformers: [...match[2].matchAll(/\[\d+\]\s*=\s*"((?:\\.|[^"])*)"/g)].map((item) => unescapeLuaString(item[1])),
  }));
}

export function parseDcsDiffLua(source, { filename = 'profile.diff.lua' } = {}) {
  if (!/\breturn\s+diff\b/.test(source)) throw new Error(`${filename} must return the diff table.`);
  const bindings = [];
  for (const section of ['keyDiffs', 'axisDiffs']) {
    for (const entry of topLevelEntries(tableBody(source, section))) {
      const name = entry.body.match(/\["name"\]\s*=\s*"((?:\\.|[^"])*)"/)?.[1];
      if (!name) throw new Error(`${filename}: ${section}.${entry.command} has no name.`);
      bindings.push({
        section,
        command: entry.command,
        name: unescapeLuaString(name),
        added: listInputs(entry.body, 'added').map(normalizeInput),
        removed: listInputs(entry.body, 'removed').map(normalizeInput),
      });
    }
  }
  return { bindings };
}

function canonicalModifiers(modifiers = []) {
  const values = [...new Set(modifiers)];
  if (values.length !== modifiers.length) throw new Error(`Modifier chord contains duplicates: ${modifiers.join(' + ')}`);
  return values.sort((left, right) => left.localeCompare(right));
}

function normalizeInput(input) {
  return { ...input, reformers: canonicalModifiers(input.reformers) };
}

export function parseDcsModifiersLua(source, { filename = 'modifiers.lua' } = {}) {
  if (!/\breturn\s+modifiers\b/.test(source)) throw new Error(`${filename} must return the modifiers table.`);
  const modifiers = topLevelEntries(rootTableBody(source, 'modifiers', filename)).map(({ command: name, body }) => {
    const value = (field) => body.match(new RegExp(`\\["${field}"\\]\\s*=\\s*"((?:\\\\.|[^"])*)"`))?.[1];
    const device = value('device');
    const key = value('key');
    const switched = body.match(/\["switch"\]\s*=\s*(true|false)/)?.[1];
    if (!device || !key || switched === undefined) throw new Error(`${filename}: modifier ${name} requires device, key, and switch.`);
    return { name, device: unescapeLuaString(device), key: unescapeLuaString(key), mode: switched === 'true' ? 'toggle' : 'hold' };
  });
  const names = new Set();
  const physical = new Map();
  for (const modifier of modifiers) {
    const folded = modifier.name.toLocaleLowerCase();
    if (names.has(folded)) throw new Error(`${filename}: duplicate modifier name (case-insensitive): ${modifier.name}`);
    names.add(folded);
    const sourceId = `${modifier.device}\0${modifier.key}`;
    if (physical.has(sourceId)) throw new Error(`${filename}: ${modifier.name} and ${physical.get(sourceId)} use the same physical input.`);
    physical.set(sourceId, modifier.name);
  }
  return { modifiers };
}

function buildModifierCatalog(config, consumerRoot) {
  const native = config.modifiersFile
    ? parseDcsModifiersLua(readFileSync(join(consumerRoot, config.modifiersFile), 'utf8'), { filename: config.modifiersFile }).modifiers
    : [];
  const byNative = new Map(native.map((modifier) => [modifier.name, modifier]));
  const aliases = new Map();
  for (const [id, specification] of Object.entries(config.modifiers ?? {})) {
    const nativeName = specification.nativeName ?? id;
    const imported = byNative.get(nativeName);
    if (config.modifiersFile && !imported) throw new Error(`Modifier ${id} references undeclared native modifier: ${nativeName}`);
    const resolved = imported ?? {
      name: nativeName,
      device: specification.device,
      key: specification.key,
      mode: specification.mode,
    };
    if (!resolved.device || !resolved.key || !['hold', 'toggle'].includes(resolved.mode)) {
      throw new Error(`Modifier ${id} requires a native declaration or device, key, and hold/toggle mode.`);
    }
    if (specification.mode && specification.mode !== resolved.mode) {
      throw new Error(`Modifier ${id} is ${resolved.mode} in modifiers.lua, not ${specification.mode}.`);
    }
    aliases.set(id, { ...resolved, id, nativeName, deviceId: specification.deviceId, label: specification.label ?? id });
  }
  for (const modifier of native) if (!aliases.has(modifier.name)) aliases.set(modifier.name, { ...modifier, id: modifier.name, nativeName: modifier.name, label: modifier.name });
  return aliases;
}

function resolveModifierSet(ids, catalog, context) {
  const nativeNames = ids.map((id) => {
    const modifier = catalog.get(id);
    if (!modifier) throw new Error(`${context}: unknown modifier: ${id}`);
    return modifier.nativeName;
  });
  return canonicalModifiers(nativeNames);
}

function sameChord(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function loadProfileDrivenConfig(configPath, options = {}) {
  const consumerRoot = resolve(options.consumerRoot ?? dirname(resolve(configPath)));
  const commonRoot = resolve(options.commonRoot ?? resolveDcsCommonRoot(consumerRoot));
  const absoluteConfig = isAbsolute(configPath) ? configPath : join(consumerRoot, configPath);
  const config = JSON.parse(readFileSync(absoluteConfig, 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('Kneeboard configuration schemaVersion must be 1.');
  if (!config.aircraft || !Array.isArray(config.pages)) throw new Error('Kneeboard configuration requires aircraft and pages.');
  const modifierCatalog = buildModifierCatalog(config, consumerRoot);

  const profileCache = new Map();
  const profile = (id) => {
    const relative = config.profiles?.[id];
    if (!relative) throw new Error(`Unknown profile alias: ${id}`);
    if (!profileCache.has(id)) {
      const filename = join(consumerRoot, relative);
      profileCache.set(id, parseDcsDiffLua(readFileSync(filename, 'utf8'), { filename: relative }));
    }
    return profileCache.get(id);
  };

  const expandedPages = config.pages.flatMap((page) => page.layers?.map((layer, index) => ({
    ...page,
    ...layer,
    layers: undefined,
    file: layer.file ?? (index === 0 ? page.file : `${page.file}-${layer.id}`),
    title: layer.title ?? page.title,
    kicker: layer.kicker ?? page.kicker,
    controls: layer.controls ?? {},
    labels: layer.labels ?? {},
    modifierIds: layer.modifiers ?? [],
  })) ?? [{ ...page, modifierIds: page.modifiers ?? [] }]);

  const outputFiles = new Set();
  const pages = expandedPages.map((page) => {
    if (!page.file || !page.deviceId) throw new Error('Every configured page requires file and deviceId.');
    if (outputFiles.has(page.file)) throw new Error(`Duplicate configured page file: ${page.file}`);
    outputFiles.add(page.file);
    const { calloutIds } = loadSharedHardware(page.deviceId, { commonRoot });
    const labels = Array.isArray(page.labels) ? [...page.labels] : { ...(page.labels ?? {}) };
    if (Array.isArray(labels) && Object.keys(page.controls ?? {}).length) {
      throw new Error(`${page.file}: profile-driven controls require ID-keyed labels.`);
    }
    const layerModifiers = resolveModifierSet(page.modifierIds, modifierCatalog, page.file);
    for (const [controlId, reference] of Object.entries(page.controls ?? {})) {
      if (!calloutIds.includes(controlId)) throw new Error(`${page.file}: ${controlId} is not a ${page.deviceId} control.`);
      const expectedModifiers = resolveModifierSet(reference.modifiers ?? page.modifierIds, modifierCatalog, `${page.file}:${controlId}`);
      const matches = profile(reference.profile).bindings.flatMap((binding) => binding.added
        .filter((input) => input.key === reference.key && sameChord(input.reformers, expectedModifiers))
        .map((input) => ({ binding, input })))
        .filter(({ binding }) => !reference.command || binding.command === reference.command);
      if (matches.length !== 1) {
        throw new Error(`${page.file}: ${reference.profile}:${reference.key} resolves to ${matches.length} bindings; specify command when ambiguous.`);
      }
      labels[controlId] = reference.label ?? matches[0].binding.name;
    }
    return {
      ...page,
      labels,
      modifierIds: [...page.modifierIds],
      modifiers: layerModifiers.map((nativeName) => [...modifierCatalog.values()].find((entry) => entry.nativeName === nativeName)),
    };
  });
  return { ...config, commonRoot, consumerRoot, modifierCatalog: Object.fromEntries(modifierCatalog), pages };
}
