import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function summarizeEffectiveAdditions(parsed) {
  const additions = parsed.bindings.flatMap((binding) => binding.added.map((input) => ({
    section: binding.section,
    command: binding.command,
    name: binding.name,
    key: input.key,
    reformers: input.reformers,
  })));
  return {
    additions,
    keyCount: additions.filter(({ section }) => section === 'keyDiffs').length,
    axisCount: additions.filter(({ section }) => section === 'axisDiffs').length,
    effective: additions.length > 0,
  };
}

export function analyzeProfileSource(source, { filename = 'profile.diff.lua', parseProfile }) {
  if (typeof parseProfile !== 'function') throw new Error('analyzeProfileSource requires parseProfile.');
  return summarizeEffectiveAdditions(parseProfile(source, { filename }));
}

export function referencedProfileIds(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedProfileIds(item, result);
  } else if (value && typeof value === 'object') {
    if (typeof value.profile === 'string') result.add(value.profile);
    for (const child of Object.values(value)) referencedProfileIds(child, result);
  }
  return result;
}

export function resolveConfiguredProfileApplicability(config, consumerRoot, { parseProfile }) {
  const referenced = referencedProfileIds(config.pages ?? []);
  const profiles = new Map();
  for (const [profileId, relativePath] of Object.entries(config.profiles ?? {})) {
    const filename = join(consumerRoot, relativePath);
    if (!existsSync(filename)) {
      profiles.set(profileId, { profileId, relativePath, filename: basename(relativePath), referenced: referenced.has(profileId),
        effective: false, keyCount: 0, axisCount: 0, additions: [], reason: 'profile file not found' });
      continue;
    }
    const summary = analyzeProfileSource(readFileSync(filename, 'utf8'), { filename: relativePath, parseProfile });
    profiles.set(profileId, { profileId, relativePath, filename: basename(relativePath), referenced: referenced.has(profileId),
      ...summary, reason: summary.effective ? 'effective key or axis additions' : 'no effective key or axis additions' });
  }
  return { profiles, referenced };
}

export function pageProfileIds(page, config) {
  const direct = referencedProfileIds(page);
  if (direct.size > 0) return direct;
  if (typeof page.profile === 'string') direct.add(page.profile);
  if (direct.size > 0) return direct;
  const identity = String(page.deviceInstance
    ? `${page.deviceId}-${String(page.deviceInstance).replace(/^MFD/iu, '')}`
    : page.deviceId ?? '').toLocaleLowerCase();
  for (const profileId of Object.keys(config.profiles ?? {})) {
    const folded = profileId.toLocaleLowerCase();
    if (folded === identity || folded === String(page.deviceId ?? '').toLocaleLowerCase()) direct.add(profileId);
  }
  return direct;
}

export function pageHasEffectiveProfile(page, config, applicability) {
  const ids = pageProfileIds(page, config);
  return ids.size > 0 && [...ids].some((id) => applicability.profiles.get(id)?.effective);
}
