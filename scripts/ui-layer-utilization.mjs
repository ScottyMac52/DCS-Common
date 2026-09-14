import { parseDcsDiffLua } from './profile-driven-kneeboard.mjs';

function luaString(value) {
  return JSON.stringify(String(value)).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}

function serializeInputs(name, inputs) {
  if (!inputs?.length) return '';
  const entries = inputs.map((input, index) => {
    const reformers = input.reformers?.length
      ? `, ["reformers"] = { ${input.reformers.map((value, i) => `[${i + 1}] = ${luaString(value)}`).join(', ')} }`
      : '';
    const filter = input.filter ? `, ["filter"] = { ${Object.entries(input.filter).map(([key, value]) => {
      if (key === 'curvature') return `["curvature"] = { ${value.map((entry, i) => `[${i + 1}] = ${entry}`).join(', ')} }`;
      return `["${key}"] = ${value}`;
    }).join(', ')} }` : '';
    return `        [${index + 1}] = { ["key"] = ${luaString(input.key)}${filter}${reformers} },`;
  });
  return `      ["${name}"] = {\n${entries.join('\n')}\n      },\n`;
}

function serializeProfile(parsed) {
  const sections = ['keyDiffs', 'axisDiffs'].map((section) => {
    const entries = parsed.bindings
      .filter((binding) => binding.section === section && (binding.added.length || (binding.changed?.length ?? 0) || binding.removed.length))
      .map((binding) => `    [${luaString(binding.command)}] = {\n${serializeInputs('added', binding.added)}${serializeInputs('changed', binding.changed ?? [])}${serializeInputs('removed', binding.removed)}      ["name"] = ${luaString(binding.name)},\n    },`);
    return entries.length ? `  ["${section}"] = {\n${entries.join('\n')}\n  },` : '';
  }).filter(Boolean);
  return `local diff = {\n${sections.join('\n')}\n}\nreturn diff\n`;
}

function chord(values = []) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameChord(left = [], right = []) {
  const a = chord(left);
  const b = chord(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizedInstance(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLocaleUpperCase();
  return /^\d+$/u.test(text) ? `MFD${text}` : text;
}

export function normalizeUiLayerUtilization(value) {
  if (value === undefined || value === null) return null;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('uiLayerUtilization must be an object.');
  }
  if (value.mode !== 'explicit') throw new Error('uiLayerUtilization.mode must be explicit.');
  if (!Array.isArray(value.bindings)) throw new Error('uiLayerUtilization.bindings must be an array.');
  const seen = new Set();
  const bindings = value.bindings.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      throw new Error(`uiLayerUtilization.bindings[${index}] must be an object.`);
    }
    for (const field of ['deviceId', 'functionId']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`uiLayerUtilization.bindings[${index}].${field} is required.`);
      }
    }
    if (entry.modifiers !== undefined && (!Array.isArray(entry.modifiers) || entry.modifiers.some((item) => typeof item !== 'string' || !item))) {
      throw new Error(`uiLayerUtilization.bindings[${index}].modifiers must be an array of names.`);
    }
    const normalized = {
      deviceId: entry.deviceId.trim(),
      deviceInstance: normalizedInstance(entry.deviceInstance),
      functionId: entry.functionId.trim(),
      modifiers: chord(entry.modifiers ?? []),
    };
    const key = [normalized.deviceId.toLocaleLowerCase(), normalized.deviceInstance ?? '', normalized.functionId, ...normalized.modifiers].join('\0');
    if (seen.has(key)) throw new Error(`Duplicate UI Layer utilization binding: ${normalized.deviceId}/${normalized.functionId}.`);
    seen.add(key);
    return normalized;
  });
  return { mode: 'explicit', bindings };
}

export function utilizedFunctionsForPage(utilization, deviceId, deviceInstance = null) {
  const normalized = normalizeUiLayerUtilization(utilization);
  if (!normalized) return null;
  const instance = normalizedInstance(deviceInstance);
  return new Set(normalized.bindings
    .filter((entry) => entry.deviceId.toLocaleLowerCase() === String(deviceId).toLocaleLowerCase()
      && (entry.deviceInstance === null || entry.deviceInstance === instance))
    .map((entry) => entry.functionId));
}

export function filterUiLayerProfile(source, {
  utilization,
  deviceId,
  deviceInstance = null,
  functions,
  filename = 'profile.diff.lua',
} = {}) {
  const normalized = normalizeUiLayerUtilization(utilization);
  if (!normalized) return source;
  const commandToFunction = new Map((functions ?? []).map((entry) => [entry.command, entry.id]));
  const instance = normalizedInstance(deviceInstance);
  const selected = normalized.bindings.filter((entry) =>
    entry.deviceId.toLocaleLowerCase() === String(deviceId).toLocaleLowerCase()
    && (entry.deviceInstance === null || entry.deviceInstance === instance));
  const parsed = parseDcsDiffLua(source, { filename });
  const matches = (binding, input) => {
    const functionId = commandToFunction.get(binding.command);
    return functionId && selected.some((entry) => entry.functionId === functionId && sameChord(entry.modifiers, input.reformers));
  };
  for (const binding of parsed.bindings) {
    binding.added = binding.added.filter((input) => matches(binding, input));
    binding.changed = (binding.changed ?? []).filter((input) => matches(binding, input));
    binding.removed = binding.removed.filter((input) => matches(binding, input));
  }
  return serializeProfile(parsed);
}
