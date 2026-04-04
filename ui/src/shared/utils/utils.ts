import type { Listing, NearbyData, NearbyPlace } from '../../types/listing'

export function parsePrice(priceStr: string | null | undefined): number | null {
  if (!priceStr) return null
  const m = priceStr.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

export function parseSqFt(sizeStr: string | null | undefined): number | null {
  if (!sizeStr) return null
  const m = sizeStr.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

/** Parse "DD/MM/YYYY" or "Now" into a Date. Returns null if unparseable. */
export function parseAvailableDate(val: string | null | undefined): Date | null {
  if (!val) return null
  if (val.toLowerCase() === 'now') return new Date()
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`
}

export function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function fetchNearbyAmenities(
  listings: Listing[]
): Promise<Record<string, NearbyData>> {
  const withCoords = listings.filter((l) => l.latitude && l.longitude)
  if (withCoords.length === 0) return {}

  const lats = withCoords.map((l) => l.latitude!)
  const lngs = withCoords.map((l) => l.longitude!)
  const BUFFER = 0.012
  const south = Math.min(...lats) - BUFFER
  const north = Math.max(...lats) + BUFFER
  const west = Math.min(...lngs) - BUFFER
  const east = Math.max(...lngs) + BUFFER

  const bbox = `${south},${west},${north},${east}`
  const query = `
[out:json][timeout:30];
(
  node["amenity"="bar"](${bbox});
  node["amenity"="pub"](${bbox});
  node["amenity"="cafe"](${bbox});
  node["shop"="supermarket"](${bbox});
  node["shop"="department_store"](${bbox});
  node["shop"="mall"](${bbox});
  way["shop"="supermarket"](${bbox});
  way["shop"="department_store"](${bbox});
  way["shop"="mall"](${bbox});
);
out center;`

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`)
  const data = await resp.json()

  const amenities: NearbyPlace[] = data.elements
    .map((el: Record<string, unknown>) => {
      const lat = (el.lat as number) ?? (el.center as Record<string, number>)?.lat
      const lon = (el.lon as number) ?? (el.center as Record<string, number>)?.lon
      if (!lat || !lon) return null
      const tags = (el.tags as Record<string, string>) || {}
      let category: string
      if (tags.amenity === 'bar' || tags.amenity === 'pub') category = 'bars'
      else if (tags.amenity === 'cafe') category = 'cafes'
      else category = 'shops'
      return { lat, lon, category, name: tags.name || '', distance_m: 0 }
    })
    .filter(Boolean) as NearbyPlace[]

  const RADIUS = 1000
  const counts: Record<string, NearbyData> = {}
  for (const listing of withCoords) {
    const key = listing.url || `${listing.latitude},${listing.longitude}`
    const places: NearbyPlace[] = []
    for (const a of amenities) {
      const dist = haversineMetres(listing.latitude!, listing.longitude!, a.lat, a.lon)
      if (dist <= RADIUS) {
        places.push({ ...a, distance_m: Math.round(dist) })
      }
    }
    places.sort((a, b) => a.distance_m - b.distance_m)
    counts[key] = {
      bars: places.filter((p) => p.category === 'bars').length,
      cafes: places.filter((p) => p.category === 'cafes').length,
      shops: places.filter((p) => p.category === 'shops').length,
      places,
    }
  }
  return counts
}
