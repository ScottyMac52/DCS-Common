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
        added: listInputs(entry.body, 'added'),
        removed: listInputs(entry.body, 'removed'),
      });
    }
  }
  return { bindings };
}

export function loadProfileDrivenConfig(configPath, options = {}) {
  const consumerRoot = resolve(options.consumerRoot ?? dirname(resolve(configPath)));
  const commonRoot = resolve(options.commonRoot ?? resolveDcsCommonRoot(consumerRoot));
  const absoluteConfig = isAbsolute(configPath) ? configPath : join(consumerRoot, configPath);
  const config = JSON.parse(readFileSync(absoluteConfig, 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('Kneeboard configuration schemaVersion must be 1.');
  if (!config.aircraft || !Array.isArray(config.pages)) throw new Error('Kneeboard configuration requires aircraft and pages.');

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

  const pages = config.pages.map((page) => {
    if (!page.file || !page.deviceId) throw new Error('Every configured page requires file and deviceId.');
    const { calloutIds } = loadSharedHardware(page.deviceId, { commonRoot });
    const labels = { ...(page.labels ?? {}) };
    for (const [controlId, reference] of Object.entries(page.controls ?? {})) {
      if (!calloutIds.includes(controlId)) throw new Error(`${page.file}: ${controlId} is not a ${page.deviceId} control.`);
      const matches = profile(reference.profile).bindings.filter((binding) =>
        binding.added.some((input) => input.key === reference.key)
        && (!reference.command || binding.command === reference.command));
      if (matches.length !== 1) {
        throw new Error(`${page.file}: ${reference.profile}:${reference.key} resolves to ${matches.length} bindings; specify command when ambiguous.`);
      }
      labels[controlId] = reference.label ?? matches[0].name;
    }
    return { ...page, labels };
  });
  return { ...config, commonRoot, consumerRoot, pages };
}
