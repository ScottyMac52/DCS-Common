import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { writeCompleteMock } from './generate-complete-build-mock.mjs';
import { renderSharedHardwarePage } from './shared-hardware-consumer.mjs';
import { loadProfileDrivenConfig } from './profile-driven-kneeboard.mjs';
import { renderKneeboard } from './kneeboard-renderer.mjs';

export async function generateTestArticles({ consumerRoot, commonRoot }) {
  writeCompleteMock({ consumerRoot, commonRoot });

  const rawConfig = JSON.parse(readFileSync(join(consumerRoot, 'config', 'kneeboard.json'), 'utf8'));
  const config = loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot, commonRoot });
  const aircraftFolder = config.aircraft.replace(/[^a-zA-Z0-9-]/g, '');
  const svgDir = join(consumerRoot, 'kneeboard', 'source');
  const pngDir = join(consumerRoot, 'kneeboard', aircraftFolder);

  rmSync(svgDir, { recursive: true, force: true });
  rmSync(pngDir, { recursive: true, force: true });
  mkdirSync(svgDir, { recursive: true });
  mkdirSync(pngDir, { recursive: true });

  const pages = [...(rawConfig.summaryPages || []), ...config.pages]
    .sort((left, right) => left.file.localeCompare(right.file));

  for (const [index, page] of pages.entries()) {
    if (page.type === 'summary') {
      const result = await renderKneeboard({
        config: { pages: [{ ...page, pageCount: pages.length }], profiles: [] },
        outputDir: pngDir,
        rootDir: consumerRoot,
      });
      for (const svgFile of result.svgFiles) {
        const svg = readFileSync(svgFile, 'utf8').replace(/1 \/ 1/, `${index + 1} / ${pages.length}`);
        writeFileSync(join(svgDir, basename(svgFile)), svg, 'utf8');
        await sharp(Buffer.from(svg)).png().toFile(join(pngDir, `${page.file}.png`));
      }
    } else if (page.deviceId) {
      const rendered = renderSharedHardwarePage({
        ...page,
        commonRoot,
        provenance: {
          consumer: `DCS-${aircraftFolder}-Components`,
          page: `${index + 1} / ${pages.length}`,
        },
      });
      writeFileSync(join(svgDir, `${page.file}.svg`), rendered.svg, 'utf8');
      await sharp(Buffer.from(rendered.svg)).png().toFile(join(pngDir, `${page.file}.png`));
    }
  }

  return { pageCount: pages.length, pngDir, svgDir };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const consumerRoot = resolve(process.argv[2] ?? join(process.cwd(), 'tmp', 'mock-consumer'));
  const commonRoot = resolve(process.argv[3] ?? process.cwd());
  rmSync(join(consumerRoot, 'src', 'Config', 'Input', 'Test', 'joystick'), { recursive: true, force: true });
  const result = await generateTestArticles({ consumerRoot, commonRoot });
  console.log(`Generated ${result.pageCount} test kneeboards.`);
  console.log(`PNG output: ${result.pngDir}`);
  console.log(`SVG output: ${result.svgDir}`);
}
