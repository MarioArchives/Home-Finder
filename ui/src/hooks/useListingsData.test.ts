import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { useListingsData } from './useListingsData'
import { sampleAmenities, sampleListingsData, scrapingStatus, setupNeededStatus } from '../test/fixtures'
import { server } from '../test/handlers'

describe('useListingsData — startup status', () => {
    it('starts in loading then transitions to ready when API says ready', async () => {
        const { result } = renderHook(() => useListingsData())
        expect(result.current.appStatus).toBe('loading')
        await waitFor(() => expect(result.current.appStatus).toBe('ready'))
    })

    it('transitions to setup_needed when API reports it', async () => {
        server.use(http.get('/api/status', () => HttpResponse.json(setupNeededStatus)))
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.appStatus).toBe('setup_needed'))
        expect(result.current.telegramConfigured).toBe(false)
    })

    it('passes through scraping status', async () => {
        server.use(http.get('/api/status', () => HttpResponse.json(scrapingStatus)))
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.appStatus).toBe('scraping'))
    })

    it('falls back to ready on /api/status failure', async () => {
        server.use(http.get('/api/status', () => HttpResponse.error()))
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.appStatus).toBe('ready'))
    })
})

describe('useListingsData — listings + amenities', () => {
    it('loads listings.json once status is ready', async () => {
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.data).not.toBeNull())
        expect(result.current.data?.city).toBe(sampleListingsData.city)
        expect(result.current.listings).toHaveLength(sampleListingsData.listings.length)
    })

    it('loads cached amenities and marks status done', async () => {
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.nearbyStatus).toBe('done'))
        expect(result.current.nearbyCounts).toEqual(sampleAmenities)
    })
})

describe('useListingsData — work pin persistence', () => {
    it('reads workPinLat/workPinLng from localStorage on init', () => {
        localStorage.setItem('workPinLat', '53.5')
        localStorage.setItem('workPinLng', '-2.3')
        const { result } = renderHook(() => useListingsData())
        expect(result.current.workPinLat).toBe('53.5')
        expect(result.current.workPinLng).toBe('-2.3')
    })

    it('writes back to localStorage when work pin changes', async () => {
        const { result } = renderHook(() => useListingsData())
        act(() => {
            result.current.setWorkPinLat('53.6')
            result.current.setWorkPinLng('-2.4')
        })
        await waitFor(() => {
            expect(localStorage.getItem('workPinLat')).toBe('53.6')
            expect(localStorage.getItem('workPinLng')).toBe('-2.4')
        })
    })

    it('removes localStorage entries when cleared', async () => {
        localStorage.setItem('workPinLat', '53.5')
        localStorage.setItem('workPinLng', '-2.3')
        const { result } = renderHook(() => useListingsData())
        act(() => {
            result.current.setWorkPinLat('')
            result.current.setWorkPinLng('')
        })
        await waitFor(() => {
            expect(localStorage.getItem('workPinLat')).toBeNull()
            expect(localStorage.getItem('workPinLng')).toBeNull()
        })
    })
})

describe('useListingsData — custom pins persistence', () => {
    it('reads pins from localStorage', () => {
        const pins = [{ id: 'a', label: 'Gym', emoji: '🏋️', lat: 53.48, lng: -2.24 }]
        localStorage.setItem('customPins', JSON.stringify(pins))
        const { result } = renderHook(() => useListingsData())
        expect(result.current.customPins).toEqual(pins)
    })

    it('returns [] when localStorage value is corrupt', () => {
        localStorage.setItem('customPins', '{not json')
        const { result } = renderHook(() => useListingsData())
        expect(result.current.customPins).toEqual([])
    })

    it('persists pins on update', async () => {
        const { result } = renderHook(() => useListingsData())
        act(() => {
            result.current.setCustomPins([{ id: 'a', label: 'Gym', emoji: '🏋️', lat: 53.48, lng: -2.24 }])
        })
        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem('customPins') || '[]')
            expect(saved).toHaveLength(1)
            expect(saved[0].id).toBe('a')
        })
    })
})

describe('useListingsData — pinDistancesMap', () => {
    it('returns {} when no pins set', async () => {
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.data).not.toBeNull())
        expect(result.current.pinDistancesMap).toEqual({})
    })

    it('computes distances from each listing to each pin', async () => {
        localStorage.setItem('customPins', JSON.stringify([
            { id: 'p1', label: 'Pin1', emoji: '📍', lat: 53.48, lng: -2.24 },
        ]))
        const { result } = renderHook(() => useListingsData())
        await waitFor(() => expect(result.current.listings.length).toBeGreaterThan(0))
        const distances = result.current.pinDistancesMap['l1']
        expect(distances).toHaveLength(1)
        expect(distances[0].label).toBe('Pin1')
        expect(distances[0].distance_m).toBeGreaterThanOrEqual(0)
    })
})
