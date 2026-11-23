import { esc, icon, placeById, placeName } from './presentation.js';
import type { Trip } from './presentation.ts';

type Point = [number, number];
type Feature = { type: number; points: Point[]; bounds: [number, number, number, number] };
type EncodedFeature = [number, number, number[]];
type Edge = { node: string; weight: number };
const worldSize = 2 ** 20;
const centerDefault: Point = [11.0013, -74.8225];

function project(lat: number, lon: number): Point {
  const radians = lat * Math.PI / 180;
  return [(lon + 180) * worldSize / 360, worldSize * (0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI))];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

class Queue {
  entries: { id: string; score: number }[] = [];

  push(id: string, score: number) {
    const entries = this.entries;
    let index = entries.length;
    entries.push({ id, score });
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (entries[parent].score <= score) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = { id, score };
  }

  pop() {
    const entries = this.entries;
    if (!entries.length) return;
    const first = entries[0];
    const last = entries.pop()!;
    if (!entries.length) return first;
    let index = 0;
    while (index * 2 + 1 < entries.length) {
      let child = index * 2 + 1;
      if (entries[child + 1]?.score < entries[child].score) child++;
      if (entries[child].score >= last.score) break;
      entries[index] = entries[child];
      index = child;
    }
    entries[index] = last;
    return first;
  }
}

const labelData: { name: string; coordinates: Point; type?: 'city' | 'water' | 'road' }[] = [
  { name: 'BARRANQUILLA', coordinates: [10.9847, -74.8170], type: 'city' },
  { name: 'Río Magdalena', coordinates: [11.026, -74.779], type: 'water' },
  { name: 'Ciénaga de Mallorquín', coordinates: [11.049, -74.840], type: 'water' },
  { name: 'Villa Campestre', coordinates: [11.0312, -74.8642] },
  { name: 'Riomar', coordinates: [11.0265, -74.8258] },
  { name: 'Villa Santos', coordinates: [11.009, -74.8380] },
  { name: 'Alto Prado', coordinates: [11.0015, -74.8076] },
  { name: 'El Prado', coordinates: [10.9945, -74.7978] },
  { name: 'La Campiña', coordinates: [11.000, -74.826] },
  { name: 'Los Nogales', coordinates: [10.9838, -74.8371] },
  { name: 'Ciudad Jardín', coordinates: [10.9862, -74.8285] },
  { name: 'Barrio Abajo', coordinates: [10.9911, -74.7819] },
  { name: 'Las Delicias', coordinates: [10.976, -74.807] },
  { name: 'El Bosque', coordinates: [10.952, -74.834] },
  { name: 'Soledad', coordinates: [10.920, -74.780], type: 'city' },
];

const features: Feature[] = [];
const network = new Map<string, { point: Point; edges: Edge[] }>();
const paths = new Map<string, { points: Point[]; schematic: boolean }>();
const labels = labelData.map(label => ({ ...label, point: project(...label.coordinates) }));
function connectingRoads(point: Point) {
  const nearby: { id: string; gap: number }[] = [];
  for (const [id, node] of network) {
    const gap = distance(point, node.point);
    if (gap <= 18) nearby.push({ id, gap });
  }
  return nearby.sort((a, b) => a.gap - b.gap).slice(0, 12);
}

function route(trip: Trip) {
  const key = `${trip.origin}/${trip.destination}`;
  const cached = paths.get(key);
  if (cached) return cached;
  const start = project(...placeById.get(trip.origin)!.coords);
  const end = project(...placeById.get(trip.destination)!.coords);
  const fallback = { points: [start, end], schematic: true };
  if (!network.size) return fallback;
  const origins = connectingRoads(start);
  const destinations = new Map(connectingRoads(end).map(({ id, gap }) => [id, gap]));
  if (!origins.length || !destinations.size) {
    paths.set(key, fallback);
    return fallback;
  }
  // Allow a few nearby road connections when the closest point leads to a dead end.
  const queue = new Queue();
  const scores = new Map<string, number>();
  const parents = new Map<string, string>();
  const visited = new Set<string>();
  const approachCost = 3;
  for (const { id, gap } of origins) {
    const cost = approachCost * gap;
    scores.set(id, cost);
    queue.push(id, cost + distance(network.get(id)!.point, end));
  }

  let target: string | undefined;
  let bestCost = Infinity;
  for (let entry = queue.pop(); entry && entry.score < bestCost; entry = queue.pop()) {
    if (visited.has(entry.id)) continue;
    visited.add(entry.id);
    const cost = scores.get(entry.id)!;
    const finalGap = destinations.get(entry.id);
    if (finalGap !== undefined && cost + finalGap * approachCost < bestCost) {
      bestCost = cost + finalGap * approachCost;
      target = entry.id;
    }
    for (const edge of network.get(entry.id)!.edges) {
      const next = cost + edge.weight;
      if (next >= (scores.get(edge.node) ?? Infinity)) continue;
      scores.set(edge.node, next);
      parents.set(edge.node, entry.id);
      queue.push(edge.node, next + distance(network.get(edge.node)!.point, end));
    }
  }
  if (!target) {
    paths.set(key, fallback);
    return fallback;
  }
  const points: Point[] = [end];
  for (let id: string | undefined = target; id; id = parents.get(id)) points.push(network.get(id)!.point);
  points.push(start);
  const path = { points: points.reverse(), schematic: false };
  paths.set(key, path);
  return path;
}

function addFeatures(data: EncodedFeature[]) {
  for (const [type, direction, encoded] of data) {
    let lon = 0;
    let lat = 0;
    let prevId = '';
    const bounds: Feature['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
    const points: Point[] = [];
    for (let i = 0; i < encoded.length; i += 2) {
      lon += encoded[i];
      lat += encoded[i + 1];
      const point = project(lat / 100000, lon / 100000);
      points.push(point);
      bounds[0] = Math.min(bounds[0], point[0]); bounds[1] = Math.min(bounds[1], point[1]);
      bounds[2] = Math.max(bounds[2], point[0]); bounds[3] = Math.max(bounds[3], point[1]);
      if (type > 2) continue;
      const id = `${lon},${lat}`;
      if (!network.has(id)) network.set(id, { point, edges: [] });
      if (prevId && prevId !== id) {
        const prev = network.get(prevId)!;
        const weight = distance(prev.point, point) * [1.5, 1.21, 1][type];
        if (direction >= 0) prev.edges.push({ node: id, weight });
        if (direction <= 0) network.get(id)!.edges.push({ node: prevId, weight });
      }
      prevId = id;
    }
    features.push({ type, points, bounds });
  }
}

let loadingMap: Promise<void> | undefined;

function loadMap() {
  loadingMap ??= fetch('./barranquilla.json').then(response => {
    if (!response.ok) throw new Error('Mapa no disponible');
    return response.json();
  }).then(addFeatures).catch(error => {
    loadingMap = undefined;
    throw error;
  });
  return loadingMap;
}

export function mapPanel(title: string, kind: 'driver' | 'detail'): string {
  return `<section class="map-panel ${kind}-map" aria-label="${esc(title)}">
    <div class="map" tabindex="0" aria-label="${esc(title)}. Usa las flechas para mover el mapa y más o menos para cambiar el zoom.">
      <canvas aria-hidden="true"></canvas>
      <div class="map-markers"></div>
    </div>
    <div class="map-caption">${icon('map')} ${esc(title)}</div>
    <div class="map-controls" aria-label="Controles del mapa"></div>
    <a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
  </section>`;
}

export function setupMap(panel: HTMLElement, onSelect?: (id: number) => void) {
  const map = panel.querySelector<HTMLElement>('.map')!;
  const canvas = map.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const markers = panel.querySelector<HTMLElement>('.map-markers')!;
  const controls = panel.querySelector<HTMLElement>('.map-controls')!;
  let center = project(...centerDefault);
  let zoom = 12.35;
  let width = 1;
  let height = 1;
  let frame = 0;
  let disposed = false;
  let fitOnResize: boolean | 'all' = false;
  let trips: Trip[] = [];
  let active: Trip | undefined;
  let markerPositions: { element: HTMLButtonElement; point: Point; offset: number }[] = [];
  let drag: { id: number; x: number; y: number; anchor: Point } | null = null;

  const scale = () => 2 ** (zoom - 12);
  const toScreen = (point: Point): Point => [(point[0] - center[0]) * scale() + width / 2, (point[1] - center[1]) * scale() + height / 2];

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  }

  function line(points: Point[]) {
    const [x, y] = toScreen(points[0]);
    ctx.moveTo(x, y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(...toScreen(points[index]));
  }

  function draw() {
    frame = 0;
    const pixelRatio = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = '#e6e6d9';
    ctx.fillRect(0, 0, width, height);
    const factor = scale();
    const left = center[0] - (width / 2 + 8) / factor;
    const right = center[0] + (width / 2 + 8) / factor;
    const top = center[1] - (height / 2 + 8) / factor;
    const bottom = center[1] + (height / 2 + 8) / factor;
    const visible = features.filter(({ bounds: [x0, y0, x1, y1] }) => x1 > left && x0 < right && y1 > top && y0 < bottom);
    for (const [kind, color] of [[3, '#bbd9d4'], [5, '#e6e6d9'], [4, '#d4e5cd']] as const) {
      ctx.fillStyle = color;
      for (const feature of visible) {
        if (feature.type !== kind) continue;
        ctx.beginPath();
        line(feature.points);
        ctx.fill();
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let type = 0; type < 3; type++) {
      ctx.beginPath();
      for (const feature of visible) if (feature.type === type) line(feature.points);
      ctx.strokeStyle = ['#f9fbf6', '#d5dbce', '#d6d9c1'][type];
      ctx.lineWidth = [zoom >= 13 ? 1.4 : 0.95, 2.9, 3.9][type];
      ctx.stroke();
      if (type) {
        ctx.strokeStyle = type === 2 ? '#fff9df' : '#fffef8';
        ctx.lineWidth = type === 2 ? 2.6 : 1.9;
        ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const label of labels) {
      if (zoom < 12.05 && !label.type) continue;
      const point = toScreen(label.point);
      if (point[0] < -80 || point[0] > width + 80 || point[1] < -15 || point[1] > height + 15) continue;
      ctx.font = label.type === 'city' ? '800 12px system-ui' : label.type === 'water' ? 'italic 12px system-ui' : '600 10.5px system-ui';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = label.type === 'water' ? '#c9e4df' : '#f2efe4';
      ctx.fillStyle = label.type === 'water' ? '#437672' : '#5a6458';
      ctx.strokeText(label.name, ...point);
      ctx.fillText(label.name, ...point);
    }
    if (panel.classList.contains('driver-map')) {
      ctx.beginPath();
      for (const trip of trips) {
        if (trip.id !== active?.id) line(route(trip).points);
      }
      ctx.strokeStyle = '#5c786ca6';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (active) {
      const selected = route(active);
      ctx.beginPath();
      line(selected.points);
      ctx.strokeStyle = '#f9fbef';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = '#1d604e';
      ctx.lineWidth = 4;
      if (selected.schematic) ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [label, point] of [['A', selected.points[0]], ['B', selected.points.at(-1)!]] as const) {
        const position = toScreen(point);
        ctx.beginPath();
        ctx.arc(...position, 10, 0, Math.PI * 2);
        ctx.fillStyle = label === 'A' ? '#1d604e' : '#ffbd86';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f9fbef';
        ctx.stroke();
        ctx.font = '700 11px system-ui';
        ctx.fillStyle = label === 'A' ? '#fff' : '#182d25';
        ctx.fillText(label, ...position);
      }
    }
    for (const { element, point, offset } of markerPositions) {
      const [x, y] = toScreen(point);
      element.hidden = x < -25 || x > width + 25 || y < -25 || y > height + 25;
      element.style.left = `${x + offset}px`;
      element.style.top = `${y}px`;
    }
  }

  function updateMarkers() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.mapId : undefined;
    const clickable = onSelect ? trips : [];
    markers.innerHTML = clickable.map(trip => `<button type="button" data-map-id="${trip.id}" class="map-marker${trip.id === active?.id ? ' is-selected' : ''}" aria-pressed="${trip.id === active?.id}" aria-label="${esc(`Ruta de ${placeName(trip.origin)} a ${placeName(trip.destination)}`)}" title="${esc(placeName(trip.destination))}">${icon('car')}</button>`).join('');
    const offsets = new Map<string, number>();
    markerPositions = Array.from(markers.querySelectorAll<HTMLButtonElement>('button'), (element, index) => {
      const origin = clickable[index].origin;
      const offset = offsets.get(origin) ?? 0;
      offsets.set(origin, offset + 25);
      return { element, point: project(...placeById.get(origin)!.coords), offset };
    });
    if (focused) markers.querySelector<HTMLElement>(`[data-map-id="${focused}"]`)?.focus({ preventScroll: true });
    schedule();
  }

  function recenter() {
    center = project(...centerDefault);
    zoom = width < 500 ? 11.65 : 12.35;
    schedule();
  }

  function zoomBy(amount: number, x = width / 2, y = height / 2) {
    const old = scale();
    zoom = Math.max(10.6, Math.min(16.3, zoom + amount));
    const delta = 1 / old - 1 / scale();
    center = [center[0] + (x - width / 2) * delta, center[1] + (y - height / 2) * delta];
    schedule();
  }

  controls.innerHTML = [['plus', 'Acercar'], ['minus', 'Alejar'], ['locate', 'Centrar mapa']].map(([id, label]) =>
    `<button type="button" data-control="${id}" class="icon-button" title="${label}" aria-label="${label}">${icon(id)}</button>`).join('');
  controls.addEventListener('click', event => {
    const key = (event.target as Element).closest<HTMLElement>('[data-control]')?.dataset.control;
    if (key === 'locate') {
      if (active) fitRoute();
      else recenter();
      schedule();
    }
    else if (key) zoomBy(key === 'plus' ? 0.6 : -0.6);
  });
  markers.addEventListener('click', event => {
    const id = (event.target as Element).closest<HTMLElement>('[data-map-id]')?.dataset.mapId;
    if (id) onSelect?.(Number(id));
  });
  map.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, anchor: [...center] };
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    center = [drag.anchor[0] - (event.clientX - drag.x) / scale(), drag.anchor[1] - (event.clientY - drag.y) / scale()];
    schedule();
  });
  map.addEventListener('lostpointercapture', () => { drag = null; });
  map.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = map.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 0.28 : -0.28, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  const panKeys: Record<string, Point> = { ArrowUp: [0, -55], ArrowDown: [0, 55], ArrowLeft: [-55, 0], ArrowRight: [55, 0] };
  map.addEventListener('keydown', event => {
    if (event.target !== map) return;
    const step = panKeys[event.key];
    if (step) center = [center[0] + step[0] / scale(), center[1] + step[1] / scale()];
    else if (event.key === '+' || event.key === '=') zoomBy(0.6);
    else if (event.key === '-') zoomBy(-0.6);
    else return;
    event.preventDefault();
    schedule();
  });
  function fitRoute() {
    if (!active) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const routesToFit = fitOnResize === 'all' ? trips : [active];
    for (const trip of routesToFit) {
      for (const [x, y] of route(trip).points) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    center = [(minX + maxX) / 2, (minY + maxY) / 2];
    const ratio = Math.min(Math.max(1, width - 110) / Math.max(1, maxX - minX), Math.max(1, height - 115) / Math.max(1, maxY - minY));
    zoom = Math.max(9, Math.min(15, 12 + Math.log2(ratio)));
  }

  const observer = new ResizeObserver(() => {
    if (!map.clientWidth) return;
    const first = width === 1;
    width = map.clientWidth;
    height = map.clientHeight;
    if (fitOnResize) fitRoute();
    else if (first) recenter();
    schedule();
  });
  observer.observe(map);
  loadMap().then(() => {
    if (fitOnResize) fitRoute();
    schedule();
  }).catch(() => {
    const caption = panel.querySelector<HTMLElement>('.map-caption')!;
    caption.textContent = 'Mapa esquemático';
  });

  return {
    update(next: Trip[], selected?: Trip, focus: boolean | 'all' = false) {
      trips = next;
      active = selected;
      fitOnResize = active ? focus : false;
      if (fitOnResize && width > 1) fitRoute();
      updateMarkers();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
