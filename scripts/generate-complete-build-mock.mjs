import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const controlPattern = /\{\s*id = "([^"]+)",\s*key = "([^"]+)",\s*type = "([^"]+)",\s*hardwareLabel = "([^"]+)"/g;

export function parseHardwareControls(source) {
  if (!/schemaVersion\s*=\s*1/.test(source)) return [];
  return [...source.matchAll(controlPattern)].map((match) => ({
    id: match[1], key: match[2], type: match[3], hardwareLabel: match[4],
  }));
}

function luaString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function mockProfile(controls) {
  const sections = { keyDiffs: [], axisDiffs: [] };
  controls.forEach((control, index) => {
    const section = control.type === 'axis' ? 'axisDiffs' : 'keyDiffs';
    sections[section].push(`    ["mock_${index + 1}"] = {\n      ["name"] = "${luaString(control.hardwareLabel)}",\n      ["added"] = { [1] = { ["key"] = "${luaString(control.key)}" } }\n    }`);
  });
  const table = (name) => `  ["${name}"] = {\n${sections[name].join(',\n')}\n  }`;
  return `local diff = {\n${table('keyDiffs')},\n${table('axisDiffs')}\n}\nreturn diff\n`;
}

function pageFile(index, deviceId) {
  return `${String(index + 2).padStart(2, '0')}-${deviceId.toUpperCase()}`;
}

export function buildCompleteMock(commonRoot) {
  const hardwareRoot = join(commonRoot, 'assets', 'shared', 'hardware');
  const manifest = JSON.parse(readFileSync(join(hardwareRoot, 'manifest.json'), 'utf8'));
  const profiles = {};
  const profileFiles = {};
  const pages = manifest.devices.map((device, index) => {
    const controls = parseHardwareControls(readFileSync(join(hardwareRoot, device.lua), 'utf8'));
    const grouped = new Map();
    for (const control of controls) {
      if (!grouped.has(control.id)) grouped.set(control.id, []);
      grouped.get(control.id).push(control);
    }
    const labels = {};
    const references = {};
    if (controls.length > 0) {
      const profile = `hardware-${device.id}`;
      const relative = `src/Config/Input/Test/joystick/${device.id}.diff.lua`;
      profiles[profile] = relative;
      profileFiles[relative] = mockProfile(controls);
      for (const [id, entries] of grouped) {
        const label = [...new Set(entries.map(({ hardwareLabel }) => hardwareLabel))].join(' / ');
        labels[id] = label;
        const refs = entries.map(({ key }) => ({ profile, key, label }));
        references[id] = refs.length === 1 ? refs[0] : refs;
      }
    }
    return {
      file: pageFile(index, device.id),
      deviceId: device.id,
      title: device.id === 'tm-mfd' ? `${device.label.toUpperCase()} — MFD3` : device.label.toUpperCase(),
      kicker: 'TEST DEVICE',
      labels,
      controls: references,
      allowUnrenderedControls: true,
    };
  });
  return {
    config: {
      schemaVersion: 1,
      aircraft: 'Test',
      includeUiLayer: true,
      profiles,
      summaryPages: [{
        type: 'summary',
        file: '01-VAICOM-OVERVIEW',
        title: 'VAICOM PRO + CONTROL OVERVIEW',
        kicker: 'VOICE-FIRST JESTER • PHYSICAL BACKUP • NO JESTER WHEEL',
        items: [
          { key: 'TX1', text: '12Joy6 • VHF AM • Ctrl+Alt+Shift+1', accent: 'gold' },
          { key: 'TX2', text: '12Joy3 • UHF • Ctrl+Alt+Shift+2', accent: 'gold' },
          { key: 'TX3', text: '12Joy4 • VHF FM • Ctrl+Alt+Shift+3', accent: 'gold' },
          { key: 'TX4', text: '12Joy5 • AUTO • Ctrl+Alt+Shift+4', accent: 'gold' },
          { key: 'TX5', text: '12Joy2 • INTERPHONE • Ctrl+Alt+Shift+5', accent: 'gold' },
        ],
      }],
      pages,
    },
    profileFiles,
  };
}

export function writeCompleteMock({ commonRoot, consumerRoot }) {
  const { config, profileFiles } = buildCompleteMock(commonRoot);
  mkdirSync(join(consumerRoot, 'config'), { recursive: true });
  mkdirSync(join(consumerRoot, 'scripts'), { recursive: true });
  mkdirSync(join(consumerRoot, 'kneeboard', 'source'), { recursive: true });
  mkdirSync(join(consumerRoot, 'kneeboard', 'assets', 'source'), { recursive: true });
  mkdirSync(join(consumerRoot, 'dist'), { recursive: true });
  mkdirSync(join(consumerRoot, 'packaging', 'release'), { recursive: true });
  mkdirSync(join(consumerRoot, 'packaging', 'ovgme'), { recursive: true });
  writeFileSync(join(consumerRoot, 'config', 'kneeboard.json'), `${JSON.stringify(config, null, 2)}\n`);
  for (const [relative, source] of Object.entries(profileFiles)) {
    const filename = join(consumerRoot, relative);
    mkdirSync(resolve(filename, '..'), { recursive: true });
    writeFileSync(filename, source);
  }
  writeFileSync(join(consumerRoot, 'packaging', 'ovgme', 'README.TXT'), 'OVGME PACKAGE VERSION {{VERSION}}\n');
  writeFileSync(join(consumerRoot, 'packaging', 'ovgme', 'VERSION.TXT'), '{{VERSION}}\n');
  writeFileSync(join(consumerRoot, 'packaging', 'release', 'RELEASE-NOTES.md'), '# Release Notes\n\nDummy release notes for testing.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const consumerRoot = resolve(process.argv[2] ?? process.cwd());
  const commonRoot = resolve(process.argv[3] ?? process.env.DCS_COMMON_ROOT ?? join(consumerRoot, '.dcs-common'));
  rmSync(join(consumerRoot, 'src', 'Config', 'Input', 'Test', 'joystick'), { recursive: true, force: true });
  writeCompleteMock({ commonRoot, consumerRoot });
  console.log(`Generated complete build mock at ${consumerRoot}`);
  console.log(`Kneeboard config: ${join(consumerRoot, 'config', 'kneeboard.json')}`);
  console.log(`Mock profiles: ${join(consumerRoot, 'src', 'Config', 'Input', 'Test', 'joystick')}`);
}
