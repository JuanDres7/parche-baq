import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Run with OSM XML extracts in .map-source/ to regenerate the bundled map.
const nodes = new Map<string, [number, number]>();
const ways = new Map<string, { type: number; refs: string[]; direction: number }>();
const waterWays = new Map<string, string[]>();
const waterRelations = new Map<string, { type: number; refs: string[] }[]>();
for (const filename of readdirSync('.map-source').filter(name => name.endsWith('.osm'))) {
  const source = readFileSync(`.map-source/${filename}`, 'utf8');
  if (!source.includes('</osm>')) throw new Error(`Recorte incompleto: ${filename}`);
  for (const node of source.matchAll(/<node\s+id="(\d+)"[^>]+lat="([\d.]+)"\s+lon="(-[\d.]+)"/g)) {
    nodes.set(node[1], [Math.round(Number(node[3]) * 100000), Math.round(Number(node[2]) * 100000)]);
  }
  for (const way of source.matchAll(/<way\s+id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const [, id, content] = way;
    const refs = Array.from(content.matchAll(/<nd ref="(\d+)"/g), match => match[1]);
    if (filename === 'magdalena.osm' || filename === 'mallorquin.osm') waterWays.set(id, refs);
    if (ways.has(id) || refs.length < 2) continue;
    const tags = Object.fromEntries(Array.from(content.matchAll(/<tag k="([^"]+)" v="([^"]+)"/g), match => [match[1], match[2]]));
    const highway = tags.highway?.replace(/_link$/, '');
    let type: number;
    if (['motorway', 'trunk', 'primary'].includes(highway)) type = 2;
    else if (['secondary', 'tertiary'].includes(highway)) type = 1;
    else if (['residential', 'unclassified', 'living_street', 'service'].includes(highway)) type = 0;
    else if (tags.natural === 'water') type = 3;
    else if (tags.leisure === 'park' || tags.natural === 'wood') type = 4;
    else continue;
    if (type >= 3 && refs[0] !== refs.at(-1)) continue;
    const direction = tags.oneway === '-1' ? -1 : tags.oneway === 'yes' || tags.junction === 'roundabout' ? 1 : 0;
    ways.set(id, { type, refs, direction });
  }
  for (const relation of source.matchAll(/<relation id="(6210916|3019707)"[^>]*>([\s\S]*?)<\/relation>/g)) {
    const members = Array.from(relation[2].matchAll(/<member type="way" ref="(\d+)" role="(inner|outer)"/g));
    waterRelations.set(relation[1], [
      { type: 3, refs: members.filter(member => member[2] === 'outer').map(member => member[1]) },
      { type: 5, refs: members.filter(member => member[2] === 'inner').map(member => member[1]) },
    ]);
  }
}

for (const [id, groups] of waterRelations) {
  for (const { type, refs } of groups) {
    const segments = refs.map(ref => waterWays.get(ref)).filter((segment): segment is string[] => Boolean(segment?.length));
    for (let index = 0; segments.length; index++) {
      const ring = [...segments.shift()!];
      while (ring[0] !== ring.at(-1)) {
        const tail = ring.at(-1);
        const match = segments.findIndex(segment => segment[0] === tail || segment.at(-1) === tail);
        if (match < 0) break;
        const [segment] = segments.splice(match, 1);
        const ordered = segment[0] === tail ? segment : [...segment].reverse();
        ring.push(...ordered.slice(1));
      }
      if (ring.length > 3 && ring[0] === ring.at(-1)) ways.set(`${id}-${type}-${index}`, { type, refs: ring, direction: 0 });
    }
  }
}

const features = [];
for (const { type, refs, direction } of ways.values()) {
  const points = refs.map(ref => nodes.get(ref));
  if (points.some(point => !point)) continue;
  const coordinates: number[] = [];
  let lastX = 0;
  let lastY = 0;
  for (const [x, y] of points as [number, number][]) {
    coordinates.push(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
  }
  features.push([type, direction, coordinates]);
}
writeFileSync('public/barranquilla.json', JSON.stringify(features));
console.log(`${features.length} vías y áreas exportadas desde OpenStreetMap.`);
