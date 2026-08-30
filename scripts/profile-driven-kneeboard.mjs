import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadSharedHardware, resolveDcsCommonRoot, modifierColorAt, MODIFIER_COLOR_CONTRACT } from './shared-hardware-consumer.mjs';
import { composeUiLayerLabels } from './ui-layer-overlays.mjs';
import { pageProfileIds, resolveConfiguredProfileApplicability } from './effective-profile-applicability.mjs';

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
  const applicability = resolveConfiguredProfileApplicability(config, consumerRoot, { parseProfile: parseDcsDiffLua });

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

  const applicablePages = expandedPages.filter((page) => {
    const ids = pageProfileIds(page, config);
    return ids.size === 0 || [...ids].some((id) => applicability.profiles.get(id)?.effective);
  });
  const outputFiles = new Set();
  const pages = applicablePages.map((page) => {
    if (!page.file || !page.deviceId) throw new Error('Every configured page requires file and deviceId.');
    if (outputFiles.has(page.file)) throw new Error(`Duplicate configured page file: ${page.file}`);
    outputFiles.add(page.file);
    const { calloutIds } = loadSharedHardware(page.deviceId, { commonRoot });
    let labels = Array.isArray(page.labels) ? [...page.labels] : { ...(page.labels ?? {}) };
    if (Array.isArray(labels) && Object.keys(page.controls ?? {}).length) {
      throw new Error(`${page.file}: profile-driven controls require ID-keyed labels.`);
    }
    const layerModifiers = resolveModifierSet(page.modifierIds, modifierCatalog, page.file);
    const labelVariants = {};
    for (c]½ßKh‘éì¶»§q«^w&—FR‚v6öæf–rö¶æVV&ö&Bæ§6öârÂ¥4ôâç7G&–æv–g’†¶æVV&ö&BÂçVÆÂÂ"’“°¢–b‚G'•'Vâ’°¢f÷"†6öç7B·&öf–ÆT¶W’Â&VÆF—fUÒöbö&¦V7BæVçG&–W2†G&gD¶æVV&ö&Bç&öf–ÆW2óò·Ò’’°¢6öç7B&Wf–÷W2ÒW†—7F–æt¶æVV&ö&Còç&öf–ÆW3òå·&öf–ÆT¶W•Ó°¢–b‡G—Vöb&Wf–÷W2ÓÒw7G&–ærrÇÂ&Wf–÷W2ÓÓÒ&VÆF—fR’6öçF–çVS°¢6öç7Bö'6öÆWFRÒ¦ö–â†÷WBÂ&Wf–÷W2“°¢–b†W†—7G57–æ2†ö'6öÆWFR’’VæÆ–æµ7–æ2†ö'6öÆWFR“°¢Ð¢f÷"†6öç7B&öf–ÆT¶W’öbÖW&vRç&VÖ÷fVE&öf–ÆW2’°¢6öç7B&VÆF—fRÒW†—7F–æt¶æVV&ö&Còç&öf–ÆW3òå·&öf–ÆT¶W•Ó°¢–b‡G—Vöb&VÆF—fRÓÒw7G&–ærr’6öçF–çVS°¢6öç7B'6öÇWFRÒ¦ö–â†÷WBÂ&VÆF—fR“°¢–b†W†—7G57–æ2†'6öÇWFR’’VæÆ–æµ7–æ2†'6öÇWFR“°¢Ð¢Ð ¢w&—FR‚w6¶vRæ§6öârÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂw6¶vRæ§6öâçF×Âr’ÂFö¶Vç2’“°¢w&—FR‚u$TDÔRæÖBrÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂu$TDÔRæÖBçF×Âr’ÂFö¶Vç2’“°¢w&—FR‚w67&—G2ö'V–ÆBÖ¶æVV&ö&BæÖ§2rÂ&VEFV×ÆFR†6öÖÖöå&ö÷BÂv'V–ÆBÖ¶æVV&ö&BæÖ§2çF×Âr’“°¢w&—FR‚w67&—G2÷FW7BÖ¶æVV&ö&BæÖ§2rÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂwFW7BÖ¶æVV&ö&BæÖ§2çF×Âr’ÂFö¶Vç2’“°¢w&—FR‚w67&—G2÷fW'6–öâæÖ§2rÂ&VEFV×ÆFR†6öÖÖöå&ö÷BÂwfW'6–öâæÖ§2çF×Âr’“°¢w&—FR‚w67&—G2÷FW7B×fW'6–öæ–æræÖ§2rÂ&VEFV×ÆFR†6öÖÖöå&ö÷BÂwFW7B×fW'6–öæ–æræÖ§2çF×Âr’“°¢w&—FR‚ræv—F‡V"÷v÷&¶fÆ÷w2ö'V–ÆBç–ÖÂrÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂv'V–ÆBç–ÖÂçF×Âr’ÂFö¶Vç2’“°¢w&—FR‚ræv—F‡V"÷v÷&¶fÆ÷w2÷&VÆV6Rç–ÖÂrÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂw&VÆV6Rç–ÖÂçF×Âr’ÂFö¶Vç2’“°¢w&—FR‚w6¶v–ærö÷fvÖRõ$TDÔRåE…BrÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂv÷fvÖRÕ$TDÔRåE…BçF×Âr’ÂFö¶Vç2’“°¢w&—FR‚w6¶v–ær÷&VÆV6Rõ$TÄT4RÔäõDU2æÖBrÂÇ•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂu$TÄT4RÔäõDU2æÖBçF×Âr’ÂFö¶Vç2’“° ¢w&—FR€¢w67&—G2ô'V–ÆBÔ÷dtÔRç3rÀ¢Ç•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂt'V–ÆBÔ÷dtÔRç3çF×Âr’ÂFö¶Vç2’À¢“°¢w&—FR€¢w67&—G2õFW7BÕ6¶vRç3rÀ¢Ç•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂuFW7BÕ6¶vRç3çF×Âr’ÂFö¶Vç2’À¢“°¢w&—FR€¢w67&—G2ô'V–ÆBÕ&VÆV6Rç3rÀ¢Ç•Fö¶Vç2‡&VEFV×ÆFR†6öÖÖöå&ö÷BÂt'V–ÆBÕ&VÆV6Rç3çF×Âr’ÂFö¶Vç2’À¢“° ¢6öç7B&W÷'DÆ–æW2Ò°¢r244ddôÄBÕ$Uõ%BrÀ¢rrÀ¢vVæW&FVB'’66fföÆBÖ6öç7VÖW"æÖ§2f÷"¢¢G¶F—7Æ”æÖWÒ¢¦À¢rrÀ¢Ò–çWBÖöGVÆS¢ÆG¶–çWDÖöGVÆT–GÕÆÀ¢Ò¶æVV&ö&B”C¢ÆG¶¶æVV&ö&D–GÕÆÀ¢Ò&öf–ÆW3¢G·&Wf–Wrç7VÖÖ'’ç&öf–ÆT6÷VçGÖÀ¢ÒÖVBFWf–6W3¢G·&Wf–Wrç7VÖÖ'’æÖVDFWf–6W7ÖÀ¢ÒVæÖVBFWf–6W3¢G·&Wf–Wrç7VÖÖ'’çVæÖVDFWf–6W7ÖÀ¢Ò&Wf–WrW'&÷'3¢G·&Wf–Wrç7VÖÖ'’æW'&÷$6÷VçGÖÀ¢Ò&W6W'fVB'6VçB&öf–ÆW3¢G¶ÖW&vRç&W6W'fVE&öf–ÆW2æÆVæwF‡ÖÀ¢ÒW‡Æ–6—FÇ’&VÖ÷fVB&öf–ÆW3¢G¶ÖW&vRç&VÖ÷fVE&öf–ÆW2æÆVæwF‡ÖÀ¢rrÀ¢r22FWf–6W2rÀ¢rrÀ¢ââç&Wf–WræFWf–6W2æÖ€¢†B’Óà¢ÒÆG¶Bç&öf–ÆTf–ÆWÕÆ(i"&öf–ÆRÆG¶Bç&öf–ÆT¶W’óòr¢¥TäÔTB¢¢wÕÆ(i"G¶BæFWf–6T–Bóòr¢¥TäÔTB¢¢wÒ‚G¶BæÖ–æu6÷W&6WÒG¶Bç&öÆRòÂ&öÆRG¶Bç&öÆWÖ¢rwÒG¶BæwV–BòÂuT”BG¶BæwV–GÖ¢rwÒG¶BæÖ–æu6÷W&6RÓÓÒw7FæFÆöæRÖfÆÆ&6²ròs²vVæW&–2#’&öf–Æ^(	G6VÆV7BF†R–ç7FÆÆVBw&—r¢rwÒ–À¢’À¢ââæÖW&vRç&W6W'fVE&öf–ÆW2æÖ‚‡&öf–ÆR’ÓâÒÆG·&öf–ÆWÕÆ(i"&W6W'fVBv†–ÆR'6VçBg&öÒF†—266fföÆB6W76–öæ’À¢ââæÖW&vRç&VÖ÷fVE&öf–ÆW2æÖ‚‡&öf–ÆR’ÓâÒÆG·&öf–ÆWÕÆ(i"W‡Æ–6—FÇ’&VÖ÷fVF’À¢rrÀ¢r22&–æF–æw2rÀ¢rrÀ¢wÂFWf–6RÂ6öçG&öÂÂD526öÖÖæBæÖRÂFWf–6RÆ&VÂÂVffV7F—fRÆ&VÂÂÆ&VÂ6÷W&6RÂrÀ¢wÂÒÒÒÂÒÒÒÂÒÒÒÂÒÒÒÂÒÒÒÂÒÒÒÂrÀ¢ââç&Wf–Wrç&÷w2æÖ‚‡&÷r’Óâ°¢6öç7B6VÆÂÒ‡fÇVR’Óâ7G&–ær‡fÇVRóòrr’ç&WÆ6TÆÂ‚wÂrÂuÅÇÂr’ç&WÆ6TÆÂ‚uÆârÂrr“°¢&WGW&âÂG¶6VÆÂ‡&÷rç7FVÒ—ÒÂG¶6VÆÂ‡&÷ræ¶W’—ÒÂG¶6VÆÂ‡&÷rææÖR—ÒÂG¶6VÆÂ‡&÷ræFWf–6TÆ&VÂ—ÒÂG¶6VÆÂ‡&÷ræÆ&VÂ—ÒÂG¶6VÆÂ‡&÷ræÆ&VÅ6÷W&6R—ÒÆ°¢Ò’À¢rrÀ¢r22æW‡B7FW2rÀ¢rrÀ¢sâ&Wf–Wr6öæf–rö¶æVV&ö&Bæ§6öæ†G&gB6öçG&öÇ2öÆ–W'2’ârÀ¢s"â&Wf–WrÆ&VÇ6Â–æ—F–Æ—¦VBg&öÒ–×÷'FVBD526öÖÖæBæÖW2âW6RV6‚&÷~(	—2D52Ô6öÖÖöâFWf–6RÆ&VÂv†Vâ†&Gv&RÖ÷&–VçFVB6ÆÆ÷WB—26ÆV&W"ârÀ¢s2â&Wf–Wr&WVFVBÖFWf–6R&öÆW2â7WÇ’Ò×&öÆW6Fò&WÆ6RuT”BÖ&6¶VBFVfVÇG2v—F‚6VÖçF–2æÖW27V6‚2ÆVgB×Fæ²Ö6öçG&öÂârÀ¢sBâçÒ6–æB6WBD55ô4ôÔÔôåõ$ôõFFòD52Ô6öÖÖöâ6†V6¶÷WBârÀ¢sRâçÒ'Vâ'V–ÆC¦¶æVV&ö&FòçÒ'VâFW7C¦¶æVV&ö&FòçÒ'VâFW7C§fW'6–öæ–ævârÀ¢sbâfÆW6‚÷WB6¶v–ær67&—G2–bF†R7GV'2æVVB6öç7VÖW"×7V6–f–2–çfVçF÷'’6†V6·2ârÀ¢rrÀ¢r22ÆææVBf–ÆW2rÀ¢rrÀ¢ââçÆææVBæÖ‚‡’ÓâÒG·Ö’À¢Ó°¢w&—FR‚u44ddôÄBÕ$Uõ%BæÖBrÂG·&W÷'DÆ–æW2æ¦ö–â‚uÆâr—ÕÆæ“° ¢&WGW&â°¢÷WGWDF—#¢÷WBÀ¢&WôæÖS¢æÖRÀ¢ÆææVDf–ÆW3¢ÆææVBÀ¢¶æVV&ö&BÀ¢G'•'VâÀ¢W'&÷'3¢&Wf–WræW'&÷'2À¢Ó°§Ð ¦W‡÷'BgVæ7F–öâÖ–â†&wbÒ&ö6W72æ&wbç6Æ–6Rƒ"’’°¢6öç7B÷F–öç2Ò'6T&w2†&wb“°¢–b†÷F–öç2æ†VÇ’°¢&–çD†VÇ‚“°¢&WGW&â°¢Ð ¢–b‚÷F–öç2ç&öf–ÆW4F—"’°¢&–çD†VÇ‚“°¢6öç6öÆRæW'&÷"‚uÆäW'&÷#¢Ò×&öf–ÆW2ÖF—"—2&WV—&VBâr“°¢&WGW&â°¢Ð ¢6öç7B&Wf–WrÒ'V–ÆE&Wf–Wr‡°¢&öf–ÆW4F—#¢÷F–öç2ç&öf–ÆW4F—"À¢ÖöF–f–W'5Fƒ¢÷F–öç2æÖöF–f–W'5F‚À¢ÖFƒ¢÷F–öç2æÖF‚À¢&öÆW5Fƒ¢÷F–öç2ç&öÆW5F‚À¢6VÖçF–4ÖöF–f–W'5Fƒ¢÷F–öç2ç6VÖçF–4ÖöF–f–W'5F‚À¢Æ&VÇ5Fƒ¢÷F–öç2æÆ&VÇ5F‚À¢Ö÷¦w&—¢÷F–öç2æÖ÷¦w&—À¢6öÖÖöå&ö÷C¢÷F–öç2æ6öÖÖöå&ö÷BÀ¢Ò“° ¢–b†÷F–öç2ç&Wf–Wt§6öâ’°¢w&—FTf–ÆU7–æ2†÷F–öç2ç&Wf–Wt§6öâÂG´¥4ôâç7G&–æv–g’‡&Wf–WrÂçVÆÂÂ"—ÕÆæÂwWFc‚r“°¢6öç6öÆRæÆör†w&÷FR&Wf–Ws¢G¶÷F–öç2ç&Wf–Wt§6öçÖ“°¢Ð ¢–b†÷F–öç2æ÷WGWDF—"’°¢–b‚÷F–öç2æF—7Æ”æÖRÇÂ÷F–öç2æ–çWDÖöGVÆT–BÇÂ÷F–öç2æ¶æVV&ö&D–B’°¢6öç6öÆRæW'&÷"‚uw&—FRÖöFR&WV—&W2ÒÖF—7Æ’ÖæÖRÂÒÖ–çWBÖÖöGVÆRÖ–BÂæBÒÖ¶æVV&ö&BÖ–Bâr“°¢&WGW&â°¢Ð¢6öç7B&W7VÇBÒw&—FT6öç7VÖW"‡°¢&Wf–WrÀ¢÷WGWDF—#¢÷F–öç2æ÷WGWDF—"À¢F—7Æ”æÖS¢÷F–öç2æF—7Æ”æÖRÀ¢–çWDÖöGVÆT–C¢÷F–öç2æ–çWDÖöGVÆT–BÀ¢¶æVV&ö&D–C¢÷F–öç2æ¶æVV&ö&D–BÀ¢&WôæÖS¢÷F–öç2ç&WôæÖRÀ¢&VÖ÷fVE&öf–ÆW3¢÷F–öç2ç&VÖ÷fU&öf–ÆW5F‚ò¥4ôâç'6R‡&VDf–ÆU7–æ2†÷F–öç2ç&VÖ÷fU&öf–ÆW5F‚ÂwWFc‚r’’¢µÒÀ¢–æ6ÇVFUV”Æ–W#¢÷F–öç2æ–æ6ÇVFUV”Æ–W"À¢G'•'Vã¢÷F–öç2æG'•'VâÀ¢6öÖÖöå&ö÷C¢÷F–öç2æ6öÖÖöå&ö÷BÀ¢Ò“°¢6öç6öÆRæÆör€¢G·&W7VÇBæG'•'VâòtG'’×'Vâr¢uw&÷FRwÒ6öç7VÖW"VæFW"G·&W7VÇBæ÷WGWDF—'Ò‚G·&W7VÇBçÆææVDf–ÆW2æÆVæwF‡ÒF‡2–À¢“°¢Ð ¢–b‚÷F–öç2ç&Wf–Wt§6öâbb÷F–öç2æ÷WGWDF—"’°¢&–çD†VÇ‚“°¢6öç6öÆRæW'&÷"‚uÆäW'&÷#¢&÷f–FRÒ×&Wf–WrÖ§6öâæBö÷"ÒÖ÷WGWBÖF—"âr“°¢&WGW&â°¢Ð ¢6öç6öÆRæÆör€¢&öf–ÆW3ÒG·&Wf–Wrç7VÖÖ'’ç&öf–ÆT6÷VçGÒ&÷w3ÒG·&Wf–Wrç7VÖÖ'’ç&÷t6÷VçGÒÖVCÒG·&Wf–Wrç7VÖÖ'’æÖVDFWf–6W7ÒVæÖVCÒG·&Wf–Wrç7VÖÖ'’çVæÖVDFWf–6W7ÒW'&÷'3ÒG·&Wf–Wrç7VÖÖ'’æW'&÷$6÷VçGÖÀ¢“°¢&WGW&â&Wf–WræW'&÷'2æÆVæwF‚âò"¢°§Ð ¦6öç7B—4F—&V7E'VâÒ&ö6W72æ&we³Òbb&W6öÇfR‡&ö6W72æ&we³Ò’ÓÓÒf–ÆUU$ÅFõF‚†–×÷'BæÖWFçW&Â“°¦–b†—4F—&V7E'Vâ’°¢G'’°¢&ö6W72æW†—D6öFRÒÖ–â‚“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"†W'&÷"æÖW76vRóòW'&÷"“°¢&ö6W72æW†—D6öFRÒ°¢Ð§Ð