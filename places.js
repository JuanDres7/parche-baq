                                                                                         

export const places          = [
  { id: 'uninorte', name: 'Universidad del Norte', area: 'Corredor Universitario', coords: [11.02133, -74.85127] },
  { id: 'uniatlantico', name: 'Universidad del Atlántico', area: 'Sede Norte', coords: [11.0206, -74.8722] },
  { id: 'unilibre', name: 'Universidad Libre', area: 'Sede Norte', coords: [11.02139, -74.86569] },
  { id: 'uac', name: 'Universidad Autónoma', area: 'Alto Prado', coords: [11.0130, -74.8259] },
  { id: 'unisimon', name: 'Universidad Simón Bolívar', area: 'Sede 1', coords: [10.99380, -74.79188] },
  { id: 'buenavista', name: 'Centro Comercial Buenavista', area: 'Riomar', coords: [11.0127, -74.8293] },
  { id: 'viva', name: 'Centro Comercial Viva', area: 'Altos de Riomar', coords: [11.0118, -74.8210] },
  { id: 'miramar', name: 'Miramar', area: 'Barranquilla', coords: [11.0035, -74.8422] },
  { id: 'portal', name: 'Portal del Prado', area: 'Barrio Abajo', coords: [10.99001, -74.78852] },
  { id: 'malecon', name: 'Gran Malecón', area: 'Ribera del Magdalena', coords: [11.02244, -74.79519] },
  { id: 'metropolitano', name: 'Estadio Metropolitano', area: 'Ciudadela 20 de Julio', coords: [10.92697, -74.80054] },
  { id: 'soledad', name: 'Portal de Soledad', area: 'Soledad', coords: [10.90760, -74.80050] },
];

function normalize(text        ) {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

// Distance to the closest matching meeting point, in kilometres as the crow flies.
export function locationDistance(query        , endpoint        )         {
  const text = normalize(query);
  if (!text) return 0;
  const point = places.find(place => place.id === endpoint);
  if (!point) return Infinity;
  const matches = places.filter(place => text.split(/\s+/).every(word =>
    normalize(`${place.name} ${place.area} ${place.id}`).includes(word)));
  if (matches.some(place => place.id === endpoint)) return 0;
  return Math.min(...matches.map(place => Math.hypot(
    (point.coords[0] - place.coords[0]) * 111.2,
    (point.coords[1] - place.coords[1]) * 109.2,
  )));
}

export const institutions = [
  'Universidad Libre', 'Universidad del Norte', 'Universidad del Atlántico',
  'Universidad Autónoma del Caribe', 'Universidad Simón Bolívar', 'Otra institución',
];
