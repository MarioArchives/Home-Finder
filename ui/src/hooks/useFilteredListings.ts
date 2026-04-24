import { useMemo } from 'react'
import { parsePrice, parseSqFt, parseAvailableDate, haversineMetres } from '../shared/utils/utils'
import type { Listing, NearbyData, FilterState } from '../types/listing'

const SHARE_KEYWORDS = ['house share', 'flat share', 'room share', 'shared house', 'shared flat', 'room in a', 'room to rent', 'double room', 'single room', 'en-suite room', 'room available']

interface UseFilteredListingsArgs {
    listings: Listing[]
    filters: FilterState
    debouncedSearch: string
    sortBy: string
    nearbyCounts: Record<string, NearbyData>
    customLat: string
    customLng: string
    commuteData: Record<string, { distance_m: number; duration_s: number }>
    workPinLat: string
    workPinLng: string
}

export interface FilterOptions {
    propertyTypes: string[]
    sources: string[]
    furnishTypes: string[]
    councilTaxBands: string[]
    bedroomCounts: number[]
    bathroomCounts: number[]
}

export function useFilteredListings({
    listings, filters, debouncedSearch, sortBy, nearbyCounts,
    customLat, customLng, commuteData, workPinLat, workPinLng,
}: UseFilteredListingsArgs) {
    const options: FilterOptions = useMemo(() => {
        const propertyTypes = new Set<string>()
        const sources = new Set<string>()
        const furnishTypes = new Set<string>()
        const councilTaxBands = new Set<string>()
        for (const l of listings) {
            if (l.property_type) propertyTypes.add(l.property_type)
            if (l.source) sources.add(l.source)
            if (l.furnish_type) furnishTypes.add(l.furnish_type)
            if (l.council_tax) councilTaxBands.add(l.council_tax)
        }
        return {
            propertyTypes: [...propertyTypes].sort(),
            sources: [...sources].sort(),
            furnishTypes: [...furnishTypes].sort(),
            councilTaxBands: [...councilTaxBands].sort(),
            bedroomCounts: [...new Set(listings.map((l) => l.bedrooms).filter((b): b is number => b != null))].sort((a, b) => a - b),
            bathroomCounts: [...new Set(listings.map((l) => l.bathrooms).filter((b): b is number => b != null))].sort((a, b) => a - b),
        }
    }, [listings])

    const valueRatings = useMemo(() => {
        const raw: { sqft: number; price: number; ppsf: number; url: string }[] = []
        for (const l of listings) {
            const sqft = parseSqFt(l.size_sq_ft)
            const price = parsePrice(l.price)
            if (sqft && sqft > 0 && price && price > 0) raw.push({ sqft, price, ppsf: price / sqft, url: l.url })
        }
        if (raw.length < 4) return {}
        const sorted = raw.map(p => p.ppsf).sort((a, b) => a - b)
        const q1 = sorted[Math.floor(sorted.length * 0.25)]
        const q3 = sorted[Math.floor(sorted.length * 0.75)]
        const iqr = q3 - q1
        const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr
        const points = raw.filter(p => p.ppsf >= lo && p.ppsf <= hi)
        if (points.length < 2) return {}
        const n = points.length
        const sumX = points.reduce((s, p) => s + p.sqft, 0)
        const sumY = points.reduce((s, p) => s + p.price, 0)
        const sumXY = points.reduce((s, p) => s + p.sqft * p.price, 0)
        const sumXX = points.reduce((s, p) => s + p.sqft * p.sqft, 0)
        const denom = n * sumXX - sumX * sumX
        if (denom === 0) return {}
        const slope = (n * sumXY - sumX * sumY) / denom
        const intercept = (sumY - slope * sumX) / n
        const ratings: Record<string, string> = {}
        for (const p of raw) {
            const expected = slope * p.sqft + intercept
            if (expected <= 0) continue
            const deviation = (p.price - expected) / expected
            if (deviation <= -0.2) ratings[p.url] = 'very good ft/£'
            else if (deviation <= -0.05) ratings[p.url] = 'good ft/£'
            else if (deviation >= 0.2) ratings[p.url] = 'very bad ft/£'
            else if (deviation >= 0.05) ratings[p.url] = 'bad ft/£'
        }
        return ratings
    }, [listings])

    const filtered = useMemo(() => {
        let result = listings.filter((l) => {
            const price = parsePrice(l.price)
            if (debouncedSearch) {
                const q = debouncedSearch.toLowerCase()
                const haystack = `${l.title} ${l.address} ${l.description} ${l.agent}`.toLowerCase()
                if (!haystack.includes(q)) return false
            }
            if (filters.minPrice && price != null && price < Number(filters.minPrice)) return false
            if (filters.maxPrice && price != null && price > Number(filters.maxPrice)) return false
            if (filters.bedrooms && (l.bedrooms == null || l.bedrooms < Number(filters.bedrooms))) return false
            if (filters.maxBedrooms && (l.bedrooms == null || l.bedrooms > Number(filters.maxBedrooms))) return false
            if (filters.bathrooms && (l.bathrooms == null || l.bathrooms < Number(filters.bathrooms))) return false
            if (filters.propertyType && l.property_type !== filters.propertyType) return false
            if (filters.propertyTypes.length > 0 && !filters.propertyTypes.includes(l.property_type)) return false
            if (filters.source && l.source !== filters.source) return false
            if (filters.furnishType && l.furnish_type !== filters.furnishType) return false
            if (filters.furnishTypes.length > 0 && (!l.furnish_type || !filters.furnishTypes.includes(l.furnish_type))) return false
            if (filters.excludeShares) {
                const text = `${l.title} ${l.description} ${l.address}`.toLowerCase()
                if (SHARE_KEYWORDS.some((kw) => text.includes(kw))) return false
            }
            if (filters.councilTax) {
                if (!l.council_tax) return false
                const bandOrder = 'ABCDEFGH'
                const maxIdx = bandOrder.indexOf(filters.councilTax)
                const match = l.council_tax.match(/Band\s+([A-H])/i)
                if (!match || bandOrder.indexOf(match[1].toUpperCase()) > maxIdx) return false
            }
            if (filters.minSqFt || filters.maxSqFt) {
                const sqft = parseSqFt(l.size_sq_ft)
                if (sqft == null) return false
                if (filters.minSqFt && sqft < Number(filters.minSqFt)) return false
                if (filters.maxSqFt && sqft > Number(filters.maxSqFt)) return false
            }
            if (filters.availableFrom || filters.availableTo) {
                const availDate = parseAvailableDate(l.available_from)
                if (!availDate) return false
                if (filters.availableFrom) { const [y, m, d] = filters.availableFrom.split('-').map(Number); if (availDate < new Date(y, m - 1, d)) return false }
                if (filters.availableTo) { const [y, m, d] = filters.availableTo.split('-').map(Number); if (availDate > new Date(y, m - 1, d, 23, 59, 59)) return false }
            }
            if (filters.pinLat && filters.pinLng && filters.pinRadius) {
                if (!l.latitude || !l.longitude) return false
                if (haversineMetres(l.latitude, l.longitude, parseFloat(filters.pinLat), parseFloat(filters.pinLng)) > Number(filters.pinRadius) * 1000) return false
            }
            return true
        })

        const seen = new Set<string>()
        result = result.filter((l) => { if (!l.url) return true; if (seen.has(l.url)) return false; seen.add(l.url); return true })

        const getClimbingDist = (url: string) => {
            const n = nearbyCounts[url]
            return n?.closest_climbing?.distance_m ?? n?.closest_amenities?.climbing?.distance_m ?? Infinity
        }
        const getCinemaDist = (url: string) => nearbyCounts[url]?.closest_amenities?.cinema?.distance_m ?? Infinity
        const getLiveliness = (url: string) => { const n = nearbyCounts[url]; return n ? n.bars + n.cafes + n.shops : 0 }
        const parsedCustomLat = parseFloat(customLat), parsedCustomLng = parseFloat(customLng)
        const hasCustomCoords = !isNaN(parsedCustomLat) && !isNaN(parsedCustomLng)
        const getCustomDist = (l: Listing) => (!hasCustomCoords || !l.latitude || !l.longitude) ? Infinity : haversineMetres(l.latitude, l.longitude, parsedCustomLat, parsedCustomLng)
        const getWorkDist = (l: Listing) => {
            const wLat = parseFloat(workPinLat), wLng = parseFloat(workPinLng)
            if (isNaN(wLat) || isNaN(wLng) || !l.latitude || !l.longitude) return Infinity
            return commuteData[l.url]?.distance_m ?? haversineMetres(l.latitude, l.longitude, wLat, wLng)
        }

        result.sort((a, b) => {
            const pa = parsePrice(a.price) ?? Infinity, pb = parsePrice(b.price) ?? Infinity
            switch (sortBy) {
                case 'price-asc': return pa - pb
                case 'price-desc': return pb - pa
                case 'beds-desc': return (b.bedrooms ?? 0) - (a.bedrooms ?? 0)
                case 'beds-asc': return (a.bedrooms ?? 0) - (b.bedrooms ?? 0)
                case 'climbing-asc': return getClimbingDist(a.url) - getClimbingDist(b.url)
                case 'cinema-asc': return getCinemaDist(a.url) - getCinemaDist(b.url)
                case 'liveliness-desc': return getLiveliness(b.url) - getLiveliness(a.url)
                case 'custom-dist-asc': return getCustomDist(a) - getCustomDist(b)
                case 'commute-asc': return getWorkDist(a) - getWorkDist(b)
                default: return 0
            }
        })
        return result
    }, [listings, filters, debouncedSearch, sortBy, nearbyCounts, customLat, customLng, commuteData, workPinLat, workPinLng])

    return { filtered, options, valueRatings }
}
