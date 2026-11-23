import { places } from './places.js';

export type User = { id: number; name: string; email: string; institution: string; bio: string; vehicle: string; demo: number };
export type Trip = {
  id: number; origin: string; destination: string; departure: string; seats: number; reserved: number;
  cost: number; notes: string; status: 'active' | 'past' | 'cancelled'; driver: string;
  institution: string; vehicle: string; mine: boolean; booked: boolean;
  payment: { amount: number; receipt: string } | null;
  rating: number | null;
  driverRating: { average: number | null; count: number };
};

const paths: Record<string, string> = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15"/>',
  case: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M8 7v13m8-13v13"/>',
  car: '<path d="m5 11 1.5-4.5h11L19 11m-15 0h16a1 1 0 0 1 1 1v5H3v-5a1 1 0 0 1 1-1Zm1 6v2m14-2v2M7 14h1m8 0h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-15a3 3 0 0 1 0 6m4 9v-2a4 4 0 0 0-2.2-3.5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><path fill="currentColor" stroke="none" d="M6 5h4v4H6zm8 5h4v4h-4zm-5 5h4v4H9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5m0 4h.01"/>',
  logout: '<path d="M11 4H5v16h6m3-4 4-4-4-4m4 4H9"/>',
  install: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
};

export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

export const placeById = new Map<string, { name: string; area: string; coords: [number, number] }>(places.map(place => [place.id, place]));
export function placeName(id: string): string {
  return placeById.get(id)?.name ?? 'Punto de encuentro';
}

export function localDate(value: Date | string): string {
  return new Date(new Date(value).valueOf() - 18000000).toISOString().slice(0, 16);
}

const shortDate = new Intl.DateTimeFormat('es-CO', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Bogota' });
const longDate = new Intl.DateTimeFormat('es-CO', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Bogota' });
const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
export function tripDate(value: string, expanded = false): string {
  const today = Date.now();
  const date = localDate(value).slice(0, 10);
  const display = date === localDate(new Date(today)).slice(0, 10) ? 'Hoy'
    : date === localDate(new Date(today + 86400000)).slice(0, 10) ? 'Mañana' : (expanded ? longDate : shortDate).format(new Date(value));
  return `${display[0].toUpperCase()}${display.slice(1)} · ${time.format(new Date(value))}`;
}

const pesos = new Intl.NumberFormat('es-CO');
export function money(amount: number): string {
  return `$${pesos.format(Math.round(amount))}`;
}

export function estimate(trip: Trip): number {
  const addingPassenger = !trip.mine && !trip.booked && trip.reserved < trip.seats && trip.status === 'active';
  return Math.ceil(trip.cost / (1 + trip.reserved + Number(addingPassenger)));
}

export function avatar(name: string, tone = 0): string {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  return `<span class="avatar tone-${tone % 3}" aria-hidden="true">${esc(initials)}</span>`;
}

const starAverage = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function driverScore(score: Trip['driverRating']): string {
  if (score.average === null) return '<span class="driver-score unrated">Sin calificaciones</span>';
  return `<span class="driver-score">${icon('star')} <strong>${starAverage.format(score.average)}/5</strong> <span>(${score.count} ${score.count === 1 ? 'calificación' : 'calificaciones'})</span></span>`;
}

export function canRate(trip: Trip): boolean {
  return trip.status === 'past' && trip.booked && !trip.mine;
}

export function statusTag(trip: Trip): string {
  if (trip.status === 'cancelled') return '<span class="tag cancelled">Cancelada</span>';
  if (canRate(trip)) {
    return trip.rating === null ? `<span class="tag">${icon('star')} Por calificar</span>`
      : `<span class="tag">${icon('star')} Tu nota: ${trip.rating}/5</span>`;
  }
  if (trip.status === 'past') return '<span class="tag neutral">Finalizada</span>';
  if (trip.booked) return `<span class="tag">${icon('check')} ${trip.payment ? 'Pagado' : trip.cost ? 'Pago pendiente' : 'Cupo reservado'}</span>`;
  if (trip.mine) return '<span class="tag">Tu publicación</span>';
  const available = trip.seats - trip.reserved;
  return available ? `<span class="tag">${icon('people')} ${available} ${available === 1 ? 'cupo' : 'cupos'}</span>` : '<span class="tag neutral">Sin cupos</span>';
}

export function journey(trip: Trip): string {
  return `<span class="journey"><span class="point" aria-hidden="true"></span><span>${esc(placeName(trip.origin))}</span><span class="point end" aria-hidden="true"></span><span>${esc(placeName(trip.destination))}</span></span>`;
}

export function tripPhoto(destination: string): string {
  if (destination === 'malecon') return './ribera.jpg';
  return ['uninorte','uniatlantico','unilibre','uac','unisimon'].includes(destination) ? './campus.jpg' : './avenida.jpg';
}

export function card(trip: Trip, selected = false, nearby = ''): string {
  return `<article class="route-card${selected ? ' selected' : ''}">
    <button type="button" class="card-main" data-action="detail" data-id="${trip.id}">
      <span class="card-top"><span class="card-date">${icon('clock')} ${esc(tripDate(trip.departure))}</span>${statusTag(trip)}</span>
      <span class="card-route"><img src="${tripPhoto(trip.destination)}" width="72" height="78" alt="" loading="lazy"><span><small>Desde ${esc(placeName(trip.origin))}</small><strong>${esc(placeName(trip.destination))}</strong></span></span>
      ${nearby ? `<small class="nearby">${esc(nearby)} en línea recta</small>` : ''}
      <span class="card-bottom">
        <span class="compact-driver">${avatar(trip.driver, trip.id)}<span><strong>${esc(trip.driver)}</strong><small>${esc(trip.institution)}</small><small>${driverScore(trip.driverRating)}</small></span></span>
        <span class="price"><strong>${money(trip.payment?.amount ?? estimate(trip))}</strong><small>${trip.payment ? (trip.status === 'cancelled' ? 'pago anulado' : 'pago simulado') : 'aporte estimado'}</small></span>
      </span>
    </button>
  </article>`;
}
