import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const manifestPath = join(root, 'assets', 'shared', 'hardware', 'manifest.json');
const outputDir = join(root, 'assets', 'shared', 'hardware', 'generated');
mkdirSync(outputDir, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lines = [];
for (const device of manifest.devices) {
  lines.push(`- ${device.label} :: ${device.svg} :: ${device.lua}`);
}
writeFileSync(join(outputDir, 'inventory.txt'), lines.join('\n') + '\n', 'utf8');

console.log(`Wrote ${manifest.devices.length} shared hardware definitions.`);
