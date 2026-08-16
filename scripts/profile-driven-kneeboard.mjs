import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadSharedHardware, resolveDcsCommonRoot, modifierColorAt, MODIFIER_COLOR_CONTRACT } from './shared-hardware-consumer.mjs';

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

  // Issue #87: one page per device with colored callouts + legend.
  // layers[] are merged onto a single page (base labels in black; shifted
  // bindings override the same callout in the modifier color). Set
  // page.separateModifierPages = true to restore the old one-file-per-layer behavior.
  const expandedPages = [];
  for (const page of config.pages) {
    if (!page.layers?.length) {
      expandedPages.push({ ...page, modifierIds: page.modifiers ?? [], controlModifiers: {} });
      continue;
    }
    if (page.separateModifierPages) {
      for (const [index, layer] of page.layers.entries()) {
        expandedPages.push({
          ...page,
          ...layer,
          layers: undefined,
          file: layer.file ?? (index === 0 ? page.file : `${page.file}-${layer.id}`),
          title: layer.title ?? page.title,
          kicker: layer.kicker ?? page.kicker,
          controls: layer.controls ?? {},
          labels: layer.labels ?? {},
          modifierIds: layer.modifiers ?? [],
          controlModifiers: {},
        });
      }
      continue;
    }
    // Combined page: merge all layers onto page.file
    const controls = {};
    const labels = { ...(page.labels ?? {}) };
    const controlModifiers = {}; // controlId -> modifier id list for coloring
    const usedModifierIds = [];
    for (const layer of page.layers) {
      const layerMods = layer.modifiers ?? [];
      for (const id of layerMods) {
        if (!usedModifierIds.includes(id)) usedModifierIds.push(id);
      }
      for (const [controlId, reference] of Object.entries(layer.controls ?? {})) {
        const references = (Array.isArray(reference) ? reference : [reference]).map((item) => ({
          ...item,
          modifiers: item.modifiers ?? layerMods,
        }));
        const existing = controls[controlId]
          ? (Array.isArray(controls[controlId]) ? controls[controlId] : [controls[controlId]])
          : [];
        const combined = [...existing, ...references];
        controls[controlId] = combined.length === 1 ? combined[0] : combined;
        if (layer.labels?.[controlId] !== undefined) labels[controlId] = layer.labels[controlId];
        controlModifiers[controlId] = [...new Set([
          ...(controlModifiers[controlId] ?? []),
          ...references.flatMap((item) => item.modifiers),
        ])];
      }
    }
    expandedPages.push({
      ...page,
      layers: undefined,
      file: page.file,
      title: page.title,
      kicker: page.kicker,
      controls,
      labels,
      modifierIds: usedModifierIds,
      controlModifiers,
    });
  }

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
    const labelVariants = {};
    for (const [controlId, configuredReference] of Object.entries(page.controls ?? {})) {
      if (!calloutIds.includes(controlId) && !page.allowUnrenderedControls) {
        throw new Error(`${page.file}: ${controlId} is not a ${page.deviceId} control.`);
      }
      const references = Array.isArray(configuredReference) ? configuredReference : [configuredReference];
      if (references.length === 0) throw new Error(`${page.file}:${controlId} must reference at least one profile binding.`);
      const resolvedVariants = references.map((reference) => {
        const expectedModifiers = resolveModifierSet(reference.modifiers ?? page.modifierIds, modifierCatalog, `${page.file}:${controlId}`);
        const matches = profile(reference.profile).bindings.flatMap((binding) => binding.added
          .filter((input) => input.key === reference.key && sameChord(input.reformers, expectedModifiers))
          .map((input) => ({ binding, input })))
          .filter(({ binding }) => !reference.command || binding.command === reference.command);
        if (matches.length !== 1) {
          throw new Error(`${page.file}: ${reference.profile}:${reference.key} resolves to ${matches.length} bindings; specify command when ambiguous.`);
        }
        return {
          label: reference.label ?? matches[0].binding.name,
          modifiers: reference.modifiers ?? page.modifierIds,
        };
      });
      labelVariants[controlId] = resolvedVariants;
      const resolvedLabels = resolvedVariants.map(({ label }) => label);
      const resolvedLabel = [...new Set(resolvedLabels)].join(' / ');
      if (labels[controlId] === undefined || labels[controlId] === '') {
        labels[controlId] = resolvedLabel;
      } else if (references.some((reference) => reference.label !== undefined)) {
        labels[controlId] = resolvedLabel;
      }
    }

    // Color index = order of first appearance among modifiers actually used on this page (not full catalog).
    const usedOrder = [];
    const noteUsed = (ids) => {
      for (const id of ids) {
        if (!usedOrder.includes(id)) usedOrder.push(id);
      }
    };
    const labelColors = {};
    for (const [controlId, configuredReference] of Object.entries(page.controls ?? {})) {
      const reference = Array.isArray(configuredReference) ? configuredReference[0] : configuredReference;
      const modIds = page.controlModifiers?.[controlId] ?? reference.modifiers ?? page.modifierIds ?? [];
      if (!modIds.length) {
        // Leave base colour to the SVG default so light-background overlays
        // (black text) and dark-box callouts (white text) both work.
        continue;
      }
      noteUsed(modIds);
      const primary = modIds[0];
      const colorIndex = usedOrder.indexOf(primary) + 1; // 1..N
      labelColors[controlId] = modifierColorAt(colorIndex);
    }
    for (const [controlId, modifierId] of Object.entries(page.modifierCallouts ?? {})) {
      noteUsed([modifierId]);
      labelColors[controlId] = modifierColorAt(usedOrder.indexOf(modifierId) + 1);
    }
    for (const [controlId, variants] of Object.entries(labelVariants)) {
      const modifierSets = new Set(variants.map((variant) => variant.modifiers.join('\0')));
      if (variants.length < 2 || modifierSets.size < 2) continue;
      labels[controlId] = variants.map((variant) => {
        const prefix = variant.modifiers.length
          ? variant.modifiers.map((id) => id.replace(/^JOY_/u, '')).join(' + ')
          : 'BASE';
        const primary = variant.modifiers[0];
        const color = primary ? modifierColorAt(usedOrder.indexOf(primary) + 1) : null;
        const fullLabel = `${prefix} — ${variant.label}`;
        const label = fullLabel.length > 30 ? `${fullLabel.slice(0, 29).trimEnd()}…` : fullLabel;
        return { label, fullLabel, color };
      });
    }
    // Only force a colour when a modifier is active; base stays device-native.

    const legendOut = [];
    if (usedOrder.length > 0) {
      legendOut.push({ label: 'Base (no modifier)', fill: modifierColorAt(0) });
      for (const [i, id] of usedOrder.entries()) {
        const entry = modifierCatalog.get(id);
        const mode = entry?.mode ? ` (${entry.mode})` : '';
        legendOut.push({
          label: `${entry?.label ?? id}${mode}`,
          fill: modifierColorAt(i + 1),
        });
      }
    }

    return {
      ...page,
      labels,
      labelColors,
      legend: legendOut,
      modifierIds: [...page.modifierIds],
      modifiers: layerModifiers.map((nativeName) => [...modifierCatalog.values()].find((entry) => entry.nativeName === nativeName)),
    };
  });
  return { ...config, commonRoot, consumerRoot, modifierCatalog: Object.fromEntries(modifierCatalog), pages };
}
