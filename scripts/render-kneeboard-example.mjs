import { renderExample } from './kneeboard-renderer.mjs';

try {
  const result = await renderExample();
  console.log(`Rendered ${result.svgFiles.length} SVG files and ${result.pngFiles.length} PNG files to ${result.outputDir}.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
