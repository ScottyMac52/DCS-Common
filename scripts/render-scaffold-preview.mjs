#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import { renderSharedHardwarePage } from './shared-hardware-consumer.mjs';
import { loadProfileDrivenConfig } from './profile-driven-kneeboard.mjs';

const [consumerRootArg, outputDirArg, profileKey] = process.argv.slice(2);
if (!consumerRootArg || !outputDirArg || !profileKey) {
  throw new Error('Usage: render-scaffold-preview.mjs <consumer-root> <output-dir> <profile-key>');
}

const consumerRoot = resolve(consumerRootArg);
const outputDir = resolve(outputDirArg);
const raw = JSON.parse(readFileSync(join(consumerRoot, 'config/kneeboard.json'), 'utf8'));
const config = loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot, commonRoot: resolve(import.meta.dirname, '..') });
const pageFiles = new Set((raw.pages ?? []).filter((page) => page.profile === profileKey ||
  Object.values(page.controls ?? {}).some((reference) => {
    const values = Array.isArray(reference) ? reference : [reference];
    return values.some((value) => value.profile === profileKey);
  }) || (page.layers ?? []).some((layer) => Object.values(layer.controls ?? {}).some((reference) => {
    const values = Array.isArray(reference) ? reference : [reference];
    return values.some((value) => value.profile === profileKey);
  }))).flatMap((page) => [page.file, ...(page.layers ?? []).map((layer) => layer.file)]));

mkdirSync(outputDir, { recursive: true });
const rendered = [];
for (const page of config.pages.filter((candidate) => pageFiles.has(candidate.file))) {
  const { svg } = renderSharedHardwarePage({ ...page, commonRoot: resolve(import.meta.dirname, '..') });
  const svgPath = join(outputDir, `${basename(page.file)}.svg`);
  const pngPath = join(outputDir, `${basename(page.file)}.png`);
  writeFileSync(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  rendered.push({ file: page.file, title: page.title, svgPath, pngPath });
}
if (rendered.length === 0) throw new Error(`No renderable pages found for profile ${profileKey}.`);
console.log(JSON.stringify(rendered));
