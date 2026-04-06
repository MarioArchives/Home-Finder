import type { Listing, NearbyData, NearbyPlace, ClosestAmenity } from '../../types/listing'

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
  const WIDE_BUFFER = 0.1
  const ws = Math.min(...lats) - WIDE_BUFFER
  const wn = Math.max(...lats) + WIDE_BUFFER
  const ww = Math.min(...lngs) - WIDE_BUFFER
  const we = Math.max(...lngs) + WIDE_BUFFER
  const wideBbox = `${ws},${ww},${wn},${we}`
  const query = `
[out:json][timeout:60];
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
  node["sport"="climbing"](${wideBbox});
  way["sport"="climbing"](${wideBbox});
  node["leisure"="sports_centre"]["sport"="climbing"](${wideBbox});
  way["leisure"="sports_centre"]["sport"="climbing"](${wideBbox});
  node["amenity"="cinema"](${wideBbox});
  way["amenity"="cinema"](${wideBbox});
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
      else if (['supermarket', 'department_store', 'mall'].includes(tags.shop)) category = 'shops'
      else if (tags.sport === 'climbing') category = 'climbing'
      else if (tags.amenity === 'cinema') category = 'cinema'
      else return null
      return { lat, lon, category, name: tags.name || '', distance_m: 0 }
    })
    .filter(Boolean) as NearbyPlace[]

  const RADIUS = 1000
  const coreCategories = new Set(['bars', 'cafes', 'shops'])
  const optionalCategories = ['climbing', 'cinema']
  const optionalPools: Record<string, NearbyPlace[]> = {}
  for (const cat of optionalCategories) {
    optionalPools[cat] = amenities.filter((a) => a.category === cat)
  }

  const counts: Record<string, NearbyData> = {}
  for (const listing of withCoords) {
    const key = listing.url || `${listing.latitude},${listing.longitude}`
    const places: NearbyPlace[] = []
    for (const a of amenities) {
      if (!coreCategories.has(a.category)) continue
      const dist = haversineMetres(listing.latitude!, listing.longitude!, a.lat, a.lon)
      if (dist <= RADIUS) {
        places.push({ ...a, distance_m: Math.round(dist) })
      }
    }
    places.sort((a, b) => a.distance_m - b.distance_m)

    const closestAmenities: Record<string, ClosestAmenity> = {}
    for (const [cat, pool] of Object.entries(optionalPools)) {
      let best: ClosestAmenity | null = null
      for (const a of pool) {
        const dist = haversineMetres(listing.latitude!, listing.longitude!, a.lat, a.lon)
        const entry: ClosestAmenity = { lat: a.lat, lon: a.lon, category: cat, name: a.name, distance_m: Math.round(dist) }
        if (!best || dist < best.distance_m) best = entry
      }
      if (best) {
        closestAmenities[cat] = best
        places.push({ lat: best.lat, lon: best.lon, category: cat, name: best.name, distance_m: best.distance_m })
      }
    }

    counts[key] = {
      bars: places.filter((p) => p.category === 'bars').length,
      cafes: places.filter((p) => p.category === 'cafes').length,
      shops: places.filter((p) => p.category === 'shops').length,
      closest_climbing: closestAmenities['climbing'],
      closest_amenities: closestAmenities,
      places,
    }
  }
  return counts
}

export async function fetchCommuteTimes(
  listings: { url: string; latitude: number; longitude: number }[],
  workLat: number,
  workLng: number,
): Promise<Record<string, { distance_m: number; duration_s: number }>> {
  const results: Record<string, { distance_m: number; duration_s: number }> = {}
  const BATCH_SIZE = 10

  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE)
    const coords = batch.map((l) => `${l.longitude},${l.latitude}`).join(';')
    const url = `https://router.project-osrm.org/table/v1/driving/${workLng},${workLat};${coords}?sources=0&annotations=distance,duration`

    try {
      const resp = await fetch(url)
      if (!resp.ok) continue
      const data = await resp.json()
      if (data.code !== 'Ok') continue

      for (let j = 0; j < batch.length; j++) {
        const distance = data.distances?.[0]?.[j + 1]
        const duration = data.durations?.[0]?.[j + 1]
        if (distance != null && duration != null) {
          results[batch[j].url] = { distance_m: Math.round(distance), duration_s: Math.round(duration) }
        }
      }
    } catch {
      // OSRM rate limited or unavailable — skip batch
    }

    if (i + BATCH_SIZE < listings.length) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return results
}
