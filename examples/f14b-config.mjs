import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');

export const config = {
  assets: {
    sampleDevice: {
      path: 'assets/source/sample-device.svg',
    },
  },
  sharedAssets: {
    componentId: 'generic-control-panel',
  },
  diffTemplate: 'local repo = "{{repo}}"\nlocal binding = "{{binding}}"\nlocal label = "{{label}}"',
  profiles: [
    {
      file: 'sample-profile',
      repo: 'sample-repo',
      bindings: [
        { name: 'primary-action', label: 'Primary action' },
        { name: 'secondary-action', label: 'Secondary action' },
      ],
    },
  ],
  pages: [
    {
      type: 'summary',
      file: '01-SHARED-OVERVIEW',
      title: 'SHARED KNEEBOARD RENDERER',
      kicker: 'CONSUMER CONFIG • COMMON RENDERER • DETERMINISTIC OUTPUT',
      items: [
        { key: 'CFG', text: 'Consumer repos supply page definitions', accent: 'cyan' },
        { key: 'ASSET', text: 'Shared assets are resolved centrally', accent: 'gold' },
        { key: 'SVG', text: 'Renderer emits standalone SVG pages', accent: 'cyan' },
        { key: 'PNG', text: 'Optional raster output is generated when Sharp is available', accent: 'gold' },
      ],
    },
    {
      type: 'hardware',
      file: '02-SAMPLE-HARDWARE',
      title: 'SAMPLE HARDWARE PAGE',
      kicker: 'CALL OUTS AND NOTES ARE POSITIONAL',
      images: [],
      callouts: [
        { key: 'BTN 1', text: 'Primary action', side: 'left', accent: 'cyan' },
        { key: 'BTN 2', text: 'Secondary action', side: 'right', accent: 'gold' },
      ],
      notes: [
        { key: 'NOTE', text: 'This example proves the shared pipeline contract.', accent: 'red' },
      ],
    },
  ],
};
