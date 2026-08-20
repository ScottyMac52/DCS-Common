import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadUiLayerCatalog({ commonRoot = root } = {}) {
  const uiRoot = join(commonRoot, 'assets', 'shared', 'ui-layer');
  const hardwareRoot = join(commonRoot, 'assets', 'shared', 'hardware');
  const functions = readJson(join(uiRoot, 'functions.json'));
  const overlays = readJson(join(uiRoot, 'hardware-overlays.json'));
  const hardware = readJson(join(hardwareRoot, 'manifest.json'));
  if (functions.schemaVersion !== 1 || overlays.schemaVersion !== 1) {
    throw new Error('Unsupported shared UI Layer schema version.');
  }
  return { functions: functions.functions, overlays, hardware: hardware.devices, commonRoot };
}

function canonicalDevice(deviceId, devices) {
  return devices.find((device) => device.id === deviceId || device.aliases?.includes(deviceId));
}

export function buildUiLayerHardwareTemplate(deviceId, catalog, { deviceInstance = null } = {}) {
  const device = canonicalDevice(deviceId, catalog.hardware);
  if (!device) throw new Error(`Unknown shared hardware device: ${deviceId}`);
  const reason = catalog.overlays.exemptions?.[device.id];
  if (reason) return { deviceId: device.id, status: 'exempt', reason, functions: [] };

  const configured = catalog.overlays.devices?.[device.id] ?? { status: 'template', bindings: {} };
  const applicableInstances = configured.appliesToInstances ?? [];
  const normalizedInstance = deviceInstance ? String(deviceInstance).toLocaleUpperCase() : null;
  if (applicableInstances.length > 0 && !applicableInstances.some(
    (instance) => String(instance).toLocaleUpperCase() === normalizedInstance,
  )) {
    return {
      deviceId: device.id,
      deviceInstance,
      status: 'not-applicable',
      reason: `UI Layer overlay applies only to: ${applicableInstances.join(', ')}`,
      modifier: null,
      functions: [],
      missing: [],
    };
  }
  const knownIds = new Set(catalog.functions.map((entry) => entry.id));
  for (const id of Object.keys(configured.bindings ?? {})) {
    if (!knownIds.has(id)) throw new Error(`${device.id}: unknown UI Layer function ${id}`);
  }

  const functions = catalog.functions.map((entry) => ({
    ...entry,
    controlId: configured.bindings?.[entry.id] ?? null,
  }));
  const missing = functions.filter((entry) => !entry.controlId).map((entry) => entry.id);
  if (configured.status === 'complete' && missing.length) {
    throw new Error(`${device.id}: completed UI Layer overlay is missing: ${missing.join(', ')}`);
  }
  return {
    deviceId: device.id,
    deviceInstance,
    status: missing.length ? 'template' : 'complete',
    modifier: configured.modifier ?? null,
    functions,
    missing,
  };
}

function labelVariants(value) {
  if (value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  return [{ label: value, fullLabel: value }];
}

export function composeUiLayerLabels(deviceId, labels = {}, { catalog = loadUiLayerCatalog(), deviceInstance = null } = {}) {
  const template = buildUiLayerHardwareTemplate(deviceId, catalog, { deviceInstance });
  const merged = Array.isArray(labels) ? [...labels] : { ...labels };
  if (['exempt', 'not-applicable'].includes(template.status) || Array.isArray(merged)) {
    return { labels: merged, template, legend: null };
  }

  for (const fn of template.functions.filter((entry) => entry.controlId)) {
    const existing = labelVariants(merged[fn.controlId]);
    const duplicate = existing.some((entry) => (entry?.fullLabel ?? entry?.label ?? entry) === fn.label);
    if (!duplicate) {
      existing.push({
        label: fn.label,
        fullLabel: fn.label,
        color: catalog.overlays.defaultColor,
        source: 'ui-layer',
        functionId: fn.id,
      });
    }
    merged[fn.controlId] = existing;
  }
  const modifierInUse = template.modifier && template.functions.some((entry) => entry.controlId);
  const legend = modifierInUse ? {
    label: `UI Layer — ${template.modifier}`,
    fill: catalog.overlays.defaultColor,
    modifierId: template.modifier,
    source: 'ui-layer',
  } : null;
  return { labels: merged, template, legend };
}

export function validateUiLayerCatalog(catalog = loadUiLayerCatalog()) {
  const results = catalog.hardware.map((device) => {
    const configured = catalog.overlays.devices?.[device.id];
    const deviceInstance = configured?.appliesToInstances?.[0] ?? null;
    return buildUiLayerHardwareTemplate(device.id, catalog, { deviceInstance });
  });
  for (const result of results) {
    if (result.status === 'exempt' || !result.functions.some((entry) => entry.controlId)) continue;
    const device = catalog.hardware.find((entry) => entry.id === result.deviceId);
    const svg = readFileSync(join(catalog.commonRoot, 'assets', 'shared', 'hardware', device.svg), 'utf8');
    const calloutIds = new Set([...svg.matchAll(/<text id="lbl-([^"]+)"/g)].map((match) => match[1]));
    for (const fn of result.functions.filter((entry) => entry.controlId)) {
      if (!calloutIds.has(fn.controlId)) {
        throw new Error(`${result.deviceId}: UI Layer function ${fn.id} references unknown control ${fn.controlId}`);
      }
    }
  }
  const configuredIds = new Set([
    ...Object.keys(catalog.overlays.devices ?? {}),
    ...Object.keys(catalog.overlays.exemptions ?? {}),
  ]);
  const unknown = [...configuredIds].filter((id) => !catalog.hardware.some((device) => device.id === id));
  if (unknown.length) throw new Error(`UI Layer overlay references unknown hardware: ${unknown.join(', ')}`);
  return results;
}
