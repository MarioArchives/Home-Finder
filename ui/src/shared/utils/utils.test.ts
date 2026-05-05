import { describe, expect, it } from 'vitest'
import { formatDistance, haversineMetres, parseAvailableDate, parsePrice, parseSqFt } from './utils'

describe('parsePrice', () => {
    it('extracts integer from "£1,200 pcm"', () => {
        expect(parsePrice('£1,200 pcm')).toBe(1200)
    })
    it('handles plain digits', () => {
        expect(parsePrice('950')).toBe(950)
    })
    it('returns null for null/undefined/empty', () => {
        expect(parsePrice(null)).toBeNull()
        expect(parsePrice(undefined)).toBeNull()
        expect(parsePrice('')).toBeNull()
    })
    it('returns null when no digits present', () => {
        expect(parsePrice('Price on request')).toBeNull()
    })
})

describe('parseSqFt', () => {
    it('strips commas', () => {
        expect(parseSqFt('1,250 sq ft')).toBe(1250)
    })
    it('handles plain digits', () => {
        expect(parseSqFt('500')).toBe(500)
    })
    it('returns null for nullish', () => {
        expect(parseSqFt(null)).toBeNull()
        expect(parseSqFt(undefined)).toBeNull()
    })
})

describe('parseAvailableDate', () => {
    it('parses "DD/MM/YYYY"', () => {
        const d = parseAvailableDate('15/03/2026')
        expect(d).not.toBeNull()
        expect(d!.getFullYear()).toBe(2026)
        expect(d!.getMonth()).toBe(2)
        expect(d!.getDate()).toBe(15)
    })
    it('"Now" → current date (within 1s)', () => {
        const d = parseAvailableDate('Now')
        expect(d).not.toBeNull()
        expect(Math.abs(Date.now() - d!.getTime())).toBeLessThan(1000)
    })
    it('returns null on garbage', () => {
        expect(parseAvailableDate('soon')).toBeNull()
        expect(parseAvailableDate(null)).toBeNull()
    })
})

describe('formatDistance', () => {
    it('formats under 1km in metres', () => {
        expect(formatDistance(800)).toBe('800m')
    })
    it('formats >=1000m as kilometres with one decimal', () => {
        expect(formatDistance(1200)).toBe('1.2km')
        expect(formatDistance(1000)).toBe('1.0km')
    })
})

describe('haversineMetres', () => {
    it('returns 0 for identical points', () => {
        expect(haversineMetres(53.48, -2.24, 53.48, -2.24)).toBe(0)
    })
    it('approx ~111 km between 1° latitude apart', () => {
        const d = haversineMetres(0, 0, 1, 0)
        expect(d).toBeGreaterThan(110_000)
        expect(d).toBeLessThan(112_000)
    })
    it('symmetric', () => {
        const a = haversineMetres(53.48, -2.24, 53.49, -2.25)
        const b = haversineMetres(53.49, -2.25, 53.48, -2.24)
        expect(a).toBeCloseTo(b, 5)
    })
})
