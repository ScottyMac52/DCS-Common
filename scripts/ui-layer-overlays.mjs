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
  return { functions: functions.functions, overlays, hardware: hardware.devices };
}

function canonicalDevice(deviceId, devices) {
  return devices.find((device) => device.id === deviceId || device.aliases?.includes(deviceId));
}

export function buildUiLayerHardwareTemplate(deviceId, catalog) {
  const device = canonicalDevice(deviceId, catalog.hardware);
  if (!device) throw new Error(`Unknown shared hardware device: ${deviceId}`);
  const reason = catalog.overlays.exemptions?.[device.id];
  if (reason) return { deviceId: device.id, status: 'exempt', reason, functions: [] };

  const configured = catalog.overlays.devices?.[device.id] ?? { status: 'template', bindings: {} };
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

export function composeUiLayerLabels(deviceId, labels = {}, { catalog = loadUiLayerCatalog() } = {}) {
  const template = buildUiLayerHardwareTemplate(deviceId, catalog);
  const merged = Array.isArray(labels) ? [...labels] : { ...labels };
  if (template.status === 'exempt' || Array.isArray(merged)) {
    return { labels: merged, template };
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
  return { labels: merged, template };
}

export function validateUiLayerCatalog(catalog = loadUiLayerCatalog()) {
  const results = catalog.hardware.map((device) => buildUiLayerHardwareTemplate(device.id, catalog));
  const configuredIds = new Set([
    ...Object.keys(catalog.overlays.devices ?? {}),
    ...Object.keys(catalog.overlays.exemptions ?? {}),
  ]);
  const unknown = [...configuredIds].filter((id) => !catalog.hardware.some((device) => device.id === id));
  if (unknown.length) throw new Error(`UI Layer overlay references unknown hardware: ${unknown.join(', ')}`);
  return results;
}
