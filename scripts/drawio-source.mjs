import { inflateRawSync } from 'node:zlib';

export function decodeDrawioGraph(xml, sourceName = 'draw.io source') {
  const diagram = xml.match(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/)?.[1]?.trim();
  if (!diagram) {
    throw new Error(`${sourceName}: draw.io source must contain a diagram`);
  }

  let graph = diagram;
  if (!diagram.startsWith('<mxGraphModel')) {
    try {
      graph = decodeURIComponent(inflateRawSync(Buffer.from(diagram, 'base64')).toString());
    } catch (error) {
      throw new Error(`${sourceName}: invalid compressed draw.io diagram`, { cause: error });
    }
  }

  if (!graph.startsWith('<mxGraphModel')) {
    throw new Error(`${sourceName}: draw.io diagram must contain an mxGraphModel`);
  }
  return graph;
}
