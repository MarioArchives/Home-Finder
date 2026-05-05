import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFilteredListings } from './useFilteredListings'
import type { FilterState, Listing, NearbyData } from '../types/listing'
import { makeListing, sampleAmenities, sampleListings } from '../test/fixtures'

const EMPTY_FILTERS: FilterState = {
    search: '', minPrice: '', maxPrice: '', bedrooms: '', maxBedrooms: '',
    bathrooms: '', propertyType: '', propertyTypes: [], source: '',
    furnishType: '', furnishTypes: [], councilTax: '', minSqFt: '', maxSqFt: '',
    availableFrom: '', availableTo: '', excludeShares: false,
    pinLat: '', pinLng: '', pinRadius: '',
}

function callHook(args: Partial<Parameters<typeof useFilteredListings>[0]> = {}) {
    const defaults = {
        listings: sampleListings,
        filters: EMPTY_FILTERS,
        debouncedSearch: '',
        sortBy: 'price-asc',
        nearbyCounts: {} as Record<string, NearbyData>,
        customLat: '',
        customLng: '',
        commuteData: {},
        workPinLat: '',
        workPinLng: '',
    }
    return renderHook(() => useFilteredListings({ ...defaults, ...args }))
}

describe('useFilteredListings — options', () => {
    it('extracts unique sorted property/source/furnish values', () => {
        const { result } = callHook()
        expect(result.current.options.propertyTypes).toEqual(['Flat', 'House'])
        expect(result.current.options.sources).toEqual(['rightmove', 'zoopla'])
        expect(result.current.options.furnishTypes).toEqual(['Furnished', 'Unfurnished'])
    })
    it('bedroomCounts/bathroomCounts numeric & sorted', () => {
        const { result } = callHook()
        expect(result.current.options.bedroomCounts).toEqual([1, 2, 3, 4])
        expect(result.current.options.bathroomCounts).toEqual([1, 2])
    })
})

describe('useFilteredListings — filtering', () => {
    it('no filters returns all listings (deduped by url)', () => {
        const { result } = callHook()
        expect(result.current.filtered).toHaveLength(sampleListings.length)
    })

    it('drops duplicate urls', () => {
        const dupes: Listing[] = [...sampleListings, makeListing({ url: 'l1' })]
        const { result } = callHook({ listings: dupes })
        const urls = result.current.filtered.map(l => l.url)
        expect(new Set(urls).size).toBe(urls.length)
    })

    it('minPrice excludes cheaper listings', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, minPrice: '1000' } })
        expect(result.current.filtered.every(l => Number(l.price.replace(/\D/g, '')) >= 1000)).toBe(true)
    })

    it('maxPrice excludes pricier listings', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, maxPrice: '1300' } })
        expect(result.current.filtered.every(l => Number(l.price.replace(/\D/g, '')) <= 1300)).toBe(true)
    })

    it('bedrooms = minimum', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, bedrooms: '3' } })
        expect(result.current.filtered.every(l => (l.bedrooms ?? 0) >= 3)).toBe(true)
    })

    it('maxBedrooms caps', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, maxBedrooms: '2' } })
        expect(result.current.filtered.every(l => (l.bedrooms ?? 0) <= 2)).toBe(true)
    })

    it('propertyTypes (multi) wins over propertyType (single)', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, propertyTypes: ['House'] } })
        expect(result.current.filtered.every(l => l.property_type === 'House')).toBe(true)
    })

    it('source filter', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, source: 'zoopla' } })
        expect(result.current.filtered.every(l => l.source === 'zoopla')).toBe(true)
    })

    it('furnishTypes excludes listings without a matching furnish_type', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, furnishTypes: ['Furnished'] } })
        expect(result.current.filtered.every(l => l.furnish_type === 'Furnished')).toBe(true)
    })

    it('debouncedSearch matches title/address/description/agent (case-insensitive)', () => {
        const { result } = callHook({ debouncedSearch: 'flat share' })
        expect(result.current.filtered).toHaveLength(1)
        expect(result.current.filtered[0].url).toBe('l5')
    })

    it('excludeShares strips listings whose text matches share keywords', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, excludeShares: true } })
        expect(result.current.filtered.find(l => l.url === 'l5')).toBeUndefined()
    })

    it('councilTax keeps band <= chosen letter', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, councilTax: 'C' } })
        const urls = result.current.filtered.map(l => l.url)
        expect(urls).toContain('l3')
        expect(urls).not.toContain('l4')
    })

    it('minSqFt/maxSqFt filter on size_sq_ft', () => {
        const { result } = callHook({ filters: { ...EMPTY_FILTERS, minSqFt: '600', maxSqFt: '1000' } })
        const sizes = result.current.filtered.map(l => Number(l.size_sq_ft))
        expect(sizes.every(s => s >= 600 && s <= 1000)).toBe(true)
    })

    it('pinLat/pinLng/pinRadius restricts by haversine distance (km)', () => {
        const { result } = callHook({
            filters: { ...EMPTY_FILTERS, pinLat: '53.48', pinLng: '-2.24', pinRadius: '1' },
        })
        expect(result.current.filtered.length).toBeGreaterThan(0)
        expect(result.current.filtered.length).toBeLessThan(sampleListings.length)
    })

    it('availableFrom/availableTo filter on parsed date', () => {
        const data: Listing[] = [
            makeListing({ url: 'a', available_from: '01/01/2026' }),
            makeListing({ url: 'b', available_from: '01/06/2026' }),
            makeListing({ url: 'c', available_from: '01/12/2026' }),
        ]
        const { result } = callHook({
            listings: data,
            filters: { ...EMPTY_FILTERS, availableFrom: '2026-05-01', availableTo: '2026-07-01' },
        })
        expect(result.current.filtered.map(l => l.url)).toEqual(['b'])
    })
})

describe('useFilteredListings — sorting', () => {
    it('price-asc', () => {
        const { result } = callHook({ sortBy: 'price-asc' })
        const prices = result.current.filtered.map(l => Number(l.price.replace(/\D/g, '')))
        expect(prices).toEqual([...prices].sort((a, b) => a - b))
    })
    it('price-desc', () => {
        const { result } = callHook({ sortBy: 'price-desc' })
        const prices = result.current.filtered.map(l => Number(l.price.replace(/\D/g, '')))
        expect(prices).toEqual([...prices].sort((a, b) => b - a))
    })
    it('beds-desc', () => {
        const { result } = callHook({ sortBy: 'beds-desc' })
        const beds = result.current.filtered.map(l => l.bedrooms ?? 0)
        expect(beds).toEqual([...beds].sort((a, b) => b - a))
    })
    it('beds-asc', () => {
        const { result } = callHook({ sortBy: 'beds-asc' })
        const beds = result.current.filtered.map(l => l.bedrooms ?? 0)
        expect(beds).toEqual([...beds].sort((a, b) => a - b))
    })
    it('climbing-asc puts listings with closer climbing first', () => {
        const { result } = callHook({ sortBy: 'climbing-asc', nearbyCounts: sampleAmenities })
        expect(result.current.filtered[0].url).toBe('l1')
    })
    it('liveliness-desc: most bars+cafes+shops first', () => {
        const { result } = callHook({ sortBy: 'liveliness-desc', nearbyCounts: sampleAmenities })
        expect(result.current.filtered[0].url).toBe('l5')
    })
    it('custom-dist-asc sorts by haversine to coords', () => {
        const { result } = callHook({ sortBy: 'custom-dist-asc', customLat: '53.47', customLng: '-2.23' })
        expect(result.current.filtered[0].url).toBe('l5')
    })
    it('commute-asc uses haversine fallback when no commuteData', () => {
        const { result } = callHook({ sortBy: 'commute-asc', workPinLat: '53.51', workPinLng: '-2.27' })
        expect(result.current.filtered[0].url).toBe('l4')
    })
    it('commute-asc prefers commuteData distance over haversine', () => {
        // workPin far away → all haversines are huge; l1's tiny commuteData wins.
        const { result } = callHook({
            sortBy: 'commute-asc',
            workPinLat: '60',
            workPinLng: '0',
            commuteData: { l1: { distance_m: 10, duration_s: 60 } },
        })
        expect(result.current.filtered[0].url).toBe('l1')
    })
})

describe('useFilteredListings — valueRatings', () => {
    it('returns {} when fewer than 4 priced+sized listings', () => {
        const small: Listing[] = sampleListings.slice(0, 2)
        const { result } = callHook({ listings: small })
        expect(result.current.valueRatings).toEqual({})
    })

    it('produces some rating labels when enough data is present', () => {
        const many: Listing[] = []
        // line: price = 2 * sqft, with one strong outlier
        for (let i = 0; i < 10; i++) {
            many.push(makeListing({ url: `n${i}`, size_sq_ft: String(500 + i * 100), price: `£${(500 + i * 100) * 2}` }))
        }
        many.push(makeListing({ url: 'cheap', size_sq_ft: '700', price: '£800' })) // ~57% under
        many.push(makeListing({ url: 'pricey', size_sq_ft: '700', price: '£2400' })) // ~71% over
        const { result } = callHook({ listings: many })
        expect(result.current.valueRatings.cheap).toMatch(/good/)
        expect(result.current.valueRatings.pricey).toMatch(/bad/)
    })
})
