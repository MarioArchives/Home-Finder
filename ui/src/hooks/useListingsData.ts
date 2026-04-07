import { useState, useEffect, useMemo, type ChangeEvent } from 'react'
import { haversineMetres, fetchNearbyAmenities, fetchCommuteTimes } from '../shared/utils/utils'
import type { Listing, ListingsData, NearbyData, CustomPin } from '../types/listing'
import type { PinDistance } from '../components/NearbyBadges/properties'

export interface ListingsDataResult {
    appStatus: 'loading' | 'setup_needed' | 'scraping' | 'amenities' | 'ready'
    setAppStatus: (s: 'loading' | 'setup_needed' | 'scraping' | 'amenities' | 'ready') => void
    telegramConfigured: boolean
    setTelegramConfigured: (v: boolean) => void
    data: ListingsData | null
    setData: (d: ListingsData | null) => void
    listings: Listing[]
    nearbyCounts: Record<string, NearbyData>
    setNearbyCounts: (c: Record<string, NearbyData>) => void
    nearbyStatus: 'idle' | 'loading' | 'done' | 'error'
    setNearbyStatus: (s: 'idle' | 'loading' | 'done' | 'error') => void

    // Work commute
    workPinLat: string
    setWorkPinLat: (v: string) => void
    workPinLng: string
    setWorkPinLng: (v: string) => void
    commuteData: Record<string, { distance_m: number; duration_s: number }>
    setCommuteData: (d: Record<string, { distance_m: number; duration_s: number }>) => void
    commuteStatus: 'idle' | 'loading' | 'done' | 'error'
    setCommuteStatus: (s: 'idle' | 'loading' | 'done' | 'error') => void

    // Custom pins
    customPins: CustomPin[]
    setCustomPins: React.Dispatch<React.SetStateAction<CustomPin[]>>
    pinDistancesMap: Record<string, PinDistance[]>

    // File loaders
    handleFileLoad: (e: ChangeEvent<HTMLInputElement>) => void
    handleAmenitiesFileLoad: (e: ChangeEvent<HTMLInputElement>) => void
}

export function useListingsData(): ListingsDataResult {
    const [appStatus, setAppStatus] = useState<ListingsDataResult['appStatus']>('loading')
    const [telegramConfigured, setTelegramConfigured] = useState(false)
    const [data, setData] = useState<ListingsData | null>(null)
    const [nearbyCounts, setNearbyCounts] = useState<Record<string, NearbyData>>({})
    const [nearbyStatus, setNearbyStatus] = useState<ListingsDataResult['nearbyStatus']>('idle')

    const [workPinLat, setWorkPinLat] = useState(() => localStorage.getItem('workPinLat') || '')
    const [workPinLng, setWorkPinLng] = useState(() => localStorage.getItem('workPinLng') || '')
    const [commuteData, setCommuteData] = useState<Record<string, { distance_m: number; duration_s: number }>>({})
    const [commuteStatus, setCommuteStatus] = useState<ListingsDataResult['commuteStatus']>('idle')

    const [customPins, setCustomPins] = useState<CustomPin[]>(() => {
        try { return JSON.parse(localStorage.getItem('customPins') || '[]') } catch { return [] }
    })

    // ---- Startup: check API status ----
    useEffect(() => {
        fetch('/api/status')
            .then(r => r.json())
            .then(s => {
                setTelegramConfigured(!!s.telegram_configured)
                const st = s.status as ListingsDataResult['appStatus']
                if (st === 'scraping' || st === 'amenities') setAppStatus(st)
                else if (st === 'ready') {
                    setAppStatus('ready')
                    // Seed setup pin from config if present
                    const pin = s.config?.pin
                    if (pin?.lat != null && pin?.lng != null && pin?.label) {
                        setCustomPins(prev => {
                            if (prev.some(p => p.id === 'setup-pin')) return prev
                            return [...prev, { id: 'setup-pin', label: pin.label, emoji: pin.emoji || '\u{1F4CD}', lat: pin.lat, lng: pin.lng }]
                        })
                    }
                }
                else setAppStatus('setup_needed')
            })
            .catch(() => setAppStatus('ready'))
    }, [])

    // ---- Load listings when ready ----
    useEffect(() => {
        if (appStatus !== 'ready') return
        fetch('/listings.json')
            .then((r) => { if (!r.ok) throw new Error('not found'); return r.json() })
            .then(setData)
            .catch(() => { })
    }, [appStatus])

    // ---- Load amenities ----
    useEffect(() => {
        if (!data?.listings?.length) return
        setNearbyStatus('loading')
        fetch('/amenities.json')
            .then((r) => { if (!r.ok) throw new Error('no cache'); return r.json() })
            .then((cached) => { setNearbyCounts(cached.properties); setNearbyStatus('done') })
            .catch(() => {
                fetchNearbyAmenities(data.listings)
                    .then((counts) => { setNearbyCounts(counts); setNearbyStatus('done') })
                    .catch(() => setNearbyStatus('error'))
            })
    }, [data])

    // ---- Persist work pin ----
    useEffect(() => {
        if (workPinLat) localStorage.setItem('workPinLat', workPinLat); else localStorage.removeItem('workPinLat')
        if (workPinLng) localStorage.setItem('workPinLng', workPinLng); else localStorage.removeItem('workPinLng')
    }, [workPinLat, workPinLng])

    // ---- Persist custom pins ----
    useEffect(() => { localStorage.setItem('customPins', JSON.stringify(customPins)) }, [customPins])

    // ---- Fetch commute times ----
    useEffect(() => {
        if (!workPinLat || !workPinLng || !data?.listings?.length) return
        const lat = parseFloat(workPinLat), lng = parseFloat(workPinLng)
        if (isNaN(lat) || isNaN(lng)) return
        const withCoords = data.listings
            .filter((l) => l.latitude && l.longitude && l.url)
            .map((l) => ({ url: l.url, latitude: l.latitude!, longitude: l.longitude! }))
        if (withCoords.length === 0) return
        setCommuteStatus('loading')
        fetchCommuteTimes(withCoords, lat, lng)
            .then((results) => { setCommuteData(results); setCommuteStatus('done') })
            .catch(() => setCommuteStatus('error'))
    }, [workPinLat, workPinLng, data])

    // ---- Derived ----
    const listings = useMemo(() => data?.listings || [], [data])

    const pinDistancesMap = useMemo(() => {
        if (customPins.length === 0) return {}
        const map: Record<string, PinDistance[]> = {}
        for (const listing of listings) {
            if (!listing.latitude || !listing.longitude || !listing.url) continue
            map[listing.url] = customPins.map((pin) => ({
                label: pin.label,
                emoji: pin.emoji,
                distance_m: Math.round(haversineMetres(listing.latitude!, listing.longitude!, pin.lat, pin.lng)),
            }))
        }
        return map
    }, [listings, customPins])

    // ---- File loaders ----
    function handleFileLoad(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]; if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => { try { setData(JSON.parse(ev.target?.result as string)) } catch { alert('Invalid JSON file') } }
        reader.readAsText(file)
    }

    function handleAmenitiesFileLoad(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]; if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => { try { const p = JSON.parse(ev.target?.result as string); setNearbyCounts(p.properties || p); setNearbyStatus('done') } catch { alert('Invalid amenities JSON file') } }
        reader.readAsText(file)
    }

    return {
        appStatus, setAppStatus, telegramConfigured, setTelegramConfigured,
        data, setData, listings, nearbyCounts, setNearbyCounts, nearbyStatus, setNearbyStatus,
        workPinLat, setWorkPinLat, workPinLng, setWorkPinLng,
        commuteData, setCommuteData, commuteStatus, setCommuteStatus,
        customPins, setCustomPins, pinDistancesMap,
        handleFileLoad, handleAmenitiesFileLoad,
    }
}
