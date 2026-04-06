import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type ChangeEvent } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { parsePrice, parseSqFt, parseAvailableDate, haversineMetres, fetchNearbyAmenities, fetchCommuteTimes } from '../../shared/utils/utils'
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet'
import PropertyCard from '../PropertyCard/PropertyCard'
import MapView from '../MapView/MapView'
import PropertyPopup from '../Analytics/components/PropertyPopup/PropertyPopup'
import SetupWizard from '../SetupWizard/SetupWizard'
import SetupProgress from '../SetupProgress/SetupProgress'
import '../../shared/mapIcons/mapIcons'
import type { Listing, ListingsData, NearbyData, FilterState, DrillDownFilter } from '../../types/listing'

const Analytics = lazy(() => import('../Analytics/Analytics'))
const Alerts = lazy(() => import('../Alerts/Alerts'))
const TelegramSetup = lazy(() => import('../TelegramSetup/TelegramSetup'))

const INITIAL_FILTERS: FilterState = {
    search: '',
    minPrice: '',
    maxPrice: '',
    bedrooms: '',
    maxBedrooms: '',
    bathrooms: '',
    propertyType: '',
    propertyTypes: [],
    source: '',
    furnishType: '',
    councilTax: '',
    minSqFt: '',
    maxSqFt: '',
    availableFrom: '',
    availableTo: '',
    excludeShares: false,
    pinLat: '',
    pinLng: '',
    pinRadius: '',
}

const SHARE_KEYWORDS = ['house share', 'flat share', 'room share', 'shared house', 'shared flat', 'room in a', 'room to rent', 'double room', 'single room', 'en-suite room', 'room available']

const PAGE_SIZE = 24

function PinPickerPopup({ lat, lng, radius, onSubmit, onClose }: {
    lat: string; lng: string; radius: number
    onSubmit: (lat: number, lng: number) => void
    onClose: () => void
}) {
    const [pendingLat, setPendingLat] = useState(lat ? parseFloat(lat) : null)
    const [pendingLng, setPendingLng] = useState(lng ? parseFloat(lng) : null)
    const center: [number, number] = pendingLat != null && pendingLng != null
        ? [pendingLat, pendingLng]
        : [53.48, -2.24]
    const hasPin = pendingLat != null && pendingLng != null

    function ClickHandler() {
        useMapEvents({
            click: (e) => {
                setPendingLat(e.latlng.lat)
                setPendingLng(e.latlng.lng)
            },
        })
        return null
    }

    return (
        <div className="pin-picker-overlay" onClick={onClose}>
            <div className="pin-picker-popup" onClick={(e) => e.stopPropagation()}>
                <div className="pin-picker-header">
                    <span className="pin-picker-label">
                        {hasPin
                            ? `Pin: ${pendingLat!.toFixed(4)}, ${pendingLng!.toFixed(4)}${radius > 0 ? ` — ${radius}km radius` : ''}`
                            : radius > 0 ? `Click the map to drop a pin (${radius}km radius)` : 'Click the map to set your location'}
                    </span>
                    <button className="pin-picker-close" onClick={onClose}>&times;</button>
                </div>
                <MapContainer center={center} zoom={12} className="pin-picker-map">
                    <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <ClickHandler />
                    {hasPin && (
                        <>
                            <Marker position={[pendingLat!, pendingLng!]} />
                            {radius > 0 && (
                                <Circle
                                    center={[pendingLat!, pendingLng!]}
                                    radius={radius * 1000}
                                    pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 2 }}
                                />
                            )}
                        </>
                    )}
                </MapContainer>
                {hasPin && (
                    <div className="pin-picker-footer">
                        <button className="pin-picker-submit" onClick={() => onSubmit(pendingLat!, pendingLng!)}>
                            Confirm pin
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

function hasActiveExtraFilters(filters: FilterState): boolean {
    return !!(
        filters.bathrooms ||
        filters.source ||
        filters.furnishType ||
        filters.councilTax ||
        filters.minSqFt ||
        filters.maxSqFt ||
        filters.availableFrom ||
        filters.availableTo ||
        filters.pinRadius
    )
}

export default function App() {
    const navigate = useNavigate()
    const location = useLocation()
    const isGridView = location.pathname === '/'
    const [appStatus, setAppStatus] = useState<'loading' | 'setup_needed' | 'scraping' | 'amenities' | 'ready'>('loading')
    const [telegramConfigured, setTelegramConfigured] = useState(false)
    const [data, setData] = useState<ListingsData | null>(null)
    const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
    const [sortBy, setSortBy] = useState('price-asc')
    const [nearbyCounts, setNearbyCounts] = useState<Record<string, NearbyData>>({})
    const [nearbyStatus, setNearbyStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const [customLat, setCustomLat] = useState('')
    const [customLng, setCustomLng] = useState('')
    const [page, setPage] = useState(1)
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [showPinPopup, setShowPinPopup] = useState(false)
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null)
    const [showMoreFilters, setShowMoreFilters] = useState(false)
    const [workPinLat, setWorkPinLat] = useState(() => localStorage.getItem('workPinLat') || '')
    const [workPinLng, setWorkPinLng] = useState(() => localStorage.getItem('workPinLng') || '')
    const [showWorkPinPopup, setShowWorkPinPopup] = useState(false)
    const [commuteData, setCommuteData] = useState<Record<string, { distance_m: number; duration_s: number }>>({})
    const [commuteStatus, setCommuteStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

    const updateSearchFilter = useCallback((value: string) => {
        setFilters(prev => ({ ...prev, search: value }))
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 300)
    }, [])

    useEffect(() => {
        fetch('/api/status')
            .then(r => r.json())
            .then(s => {
                const st = s.status as typeof appStatus
                setTelegramConfigured(!!s.telegram_configured)
                if (st === 'scraping' || st === 'amenities') {
                    setAppStatus(st)
                } else if (st === 'ready') {
                    setAppStatus('ready')
                } else {
                    setAppStatus('setup_needed')
                }
            })
            .catch(() => setAppStatus('ready'))
    }, [])

    useEffect(() => {
        if (appStatus !== 'ready') return
        fetch('/listings.json')
            .then((r) => {
                if (!r.ok) throw new Error('not found')
                return r.json()
            })
            .then(setData)
            .catch(() => { })
    }, [appStatus])

    function handleFileLoad(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                setData(JSON.parse(ev.target?.result as string))
            } catch {
                alert('Invalid JSON file')
            }
        }
        reader.readAsText(file)
    }

    function handleAmenitiesFileLoad(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string)
                setNearbyCounts(parsed.properties || parsed)
                setNearbyStatus('done')
            } catch {
                alert('Invalid amenities JSON file')
            }
        }
        reader.readAsText(file)
    }

    useEffect(() => {
        if (!data?.listings?.length) return
        setNearbyStatus('loading')
        fetch('/amenities.json')
            .then((r) => {
                if (!r.ok) throw new Error('no cache')
                return r.json()
            })
            .then((cached) => {
                setNearbyCounts(cached.properties)
                setNearbyStatus('done')
            })
            .catch(() => {
                fetchNearbyAmenities(data.listings)
                    .then((counts) => {
                        setNearbyCounts(counts)
                        setNearbyStatus('done')
                    })
                    .catch(() => setNearbyStatus('error'))
            })
    }, [data])

    useEffect(() => {
        if (workPinLat) localStorage.setItem('workPinLat', workPinLat)
        else localStorage.removeItem('workPinLat')
        if (workPinLng) localStorage.setItem('workPinLng', workPinLng)
        else localStorage.removeItem('workPinLng')
    }, [workPinLat, workPinLng])

    useEffect(() => {
        if (!workPinLat || !workPinLng || !data?.listings?.length) return
        const lat = parseFloat(workPinLat)
        const lng = parseFloat(workPinLng)
        if (isNaN(lat) || isNaN(lng)) return

        const withCoords = data.listings
            .filter((l) => l.latitude && l.longitude && l.url)
            .map((l) => ({ url: l.url, latitude: l.latitude!, longitude: l.longitude! }))
        if (withCoords.length === 0) return

        setCommuteStatus('loading')
        fetchCommuteTimes(withCoords, lat, lng)
            .then((results) => {
                setCommuteData(results)
                setCommuteStatus('done')
            })
            .catch(() => setCommuteStatus('error'))
    }, [workPinLat, workPinLng, data])

    const listings = useMemo(() => data?.listings || [], [data])

    const options = useMemo(() => {
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
            if (sqft && sqft > 0 && price && price > 0) {
                raw.push({ sqft, price, ppsf: price / sqft, url: l.url })
            }
        }
        if (raw.length < 4) return {}

        const sorted = raw.map(p => p.ppsf).sort((a, b) => a - b)
        const q1 = sorted[Math.floor(sorted.length * 0.25)]
        const q3 = sorted[Math.floor(sorted.length * 0.75)]
        const iqr = q3 - q1
        const lo = q1 - 1.5 * iqr
        const hi = q3 + 1.5 * iqr
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
                if (filters.availableFrom) {
                    const [y, m, d] = filters.availableFrom.split('-').map(Number)
                    if (availDate < new Date(y, m - 1, d)) return false
                }
                if (filters.availableTo) {
                    const [y, m, d] = filters.availableTo.split('-').map(Number)
                    if (availDate > new Date(y, m - 1, d, 23, 59, 59)) return false
                }
            }
            if (filters.pinLat && filters.pinLng && filters.pinRadius) {
                if (!l.latitude || !l.longitude) return false
                const dist = haversineMetres(l.latitude, l.longitude, parseFloat(filters.pinLat), parseFloat(filters.pinLng))
                if (dist > Number(filters.pinRadius) * 1000) return false
            }
            return true
        })

        const seen = new Set<string>()
        result = result.filter((l) => {
            if (!l.url) return true
            if (seen.has(l.url)) return false
            seen.add(l.url)
            return true
        })

        const getClimbingDist = (url: string) => {
            const n = nearbyCounts[url]
            return n?.closest_climbing?.distance_m ?? n?.closest_amenities?.climbing?.distance_m ?? Infinity
        }
        const getCinemaDist = (url: string) => nearbyCounts[url]?.closest_amenities?.cinema?.distance_m ?? Infinity
        const getLiveliness = (url: string) => {
            const n = nearbyCounts[url]
            return n ? n.bars + n.cafes + n.shops : 0
        }
        const parsedCustomLat = parseFloat(customLat)
        const parsedCustomLng = parseFloat(customLng)
        const hasCustomCoords = !isNaN(parsedCustomLat) && !isNaN(parsedCustomLng)
        const getCustomDist = (l: typeof result[0]) => {
            if (!hasCustomCoords || !l.latitude || !l.longitude) return Infinity
            return haversineMetres(l.latitude, l.longitude, parsedCustomLat, parsedCustomLng)
        }
        const getWorkDist = (l: typeof result[0]) => {
            const parsedWorkLat = parseFloat(workPinLat)
            const parsedWorkLng = parseFloat(workPinLng)
            if (isNaN(parsedWorkLat) || isNaN(parsedWorkLng) || !l.latitude || !l.longitude) return Infinity
            return commuteData[l.url]?.distance_m ?? haversineMetres(l.latitude, l.longitude, parsedWorkLat, parsedWorkLng)
        }

        result.sort((a, b) => {
            const pa = parsePrice(a.price) ?? Infinity
            const pb = parsePrice(b.price) ?? Infinity
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

    useEffect(() => { setPage(1) }, [filtered])

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
    const paged = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])

    const updateFilter = (key: keyof FilterState, value: string) =>
        setFilters((prev) => ({ ...prev, [key]: value }))

    const handleDrillDown = useCallback((drillFilter: DrillDownFilter) => {
        setFilters({ ...INITIAL_FILTERS, ...drillFilter })
        setPage(1)
        navigate('/')
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }, [navigate])

    if (appStatus === 'loading') {
        return <div className="load-screen"><p>Loading...</p></div>
    }

    if (appStatus === 'setup_needed') {
        return <SetupWizard onStarted={() => setAppStatus('scraping')} />
    }

    if (appStatus === 'scraping' || appStatus === 'amenities') {
        return <SetupProgress onComplete={() => {
            setAppStatus('ready')
        }} />
    }

    if (!data) {
        return (
            <div className="load-screen">
                <h2>Property Listings Viewer</h2>
                <p>Load a scraped listings JSON file to get started.</p>
                <div className="file-input-wrapper">
                    <input type="file" id="file-input" accept=".json" onChange={handleFileLoad} />
                    <label htmlFor="file-input">Choose JSON file</label>
                </div>
            </div>
        )
    }

    const extraFilterCount = [
        filters.bathrooms,
        filters.source,
        filters.furnishType,
        filters.councilTax,
        filters.minSqFt,
        filters.maxSqFt,
        filters.availableFrom,
        filters.availableTo,
        filters.pinRadius,
    ].filter(Boolean).length

    return (
        <>
            <header className="app-topbar">
                <div className="toolbar-top">
                    <div className="toolbar-title">
                        <h1>{data.city} — {data.listing_type === 'rent' ? 'Rentals' : 'For Sale'}</h1>
                        <div className="stats">
                            {filtered.length} of {new Set(listings.map((l) => l.url)).size} properties
                            {data.scraped_at && <> &middot; Scraped {new Date(data.scraped_at).toLocaleDateString()}</>}
                            {nearbyStatus === 'loading' && <> &middot; Loading nearby places...</>}
                            {nearbyStatus === 'error' && (
                                <>
                                    &middot; <label className="inline-file-link">
                                        <input type="file" accept=".json" onChange={handleAmenitiesFileLoad} hidden />
                                        Load amenities file
                                    </label>
                                </>
                            )}
                            <span className="load-different-link"
                                onClick={() => { setData(null); setFilters(INITIAL_FILTERS); setNearbyCounts({}); setNearbyStatus('idle') }}>
                                Load different file
                            </span>
                        </div>
                    </div>
                    <nav className="view-nav">
                        <NavLink to="/" end className={({ isActive }) => `view-btn ${isActive ? 'active' : ''}`}>Grid</NavLink>
                        <NavLink to="/map" className={({ isActive }) => `view-btn ${isActive ? 'active' : ''}`}>Map</NavLink>
                        <NavLink to="/analytics" className={({ isActive }) => `view-btn ${isActive ? 'active' : ''}`}>Analytics</NavLink>
                        <NavLink to="/alerts" className={({ isActive }) => `view-btn ${isActive ? 'active' : ''}`}>Alerts</NavLink>
                    </nav>
                </div>
            </header>

            <div className="filters">
                    <div className="filter-row primary-filters">
                        <div className="filter-group search">
                            <label>Search</label>
                            <input type="text" placeholder="Address, description, agent..." value={filters.search} onChange={(e) => updateSearchFilter(e.target.value)} />
                        </div>
                        <div className="filter-group">
                            <label>Min price</label>
                            <input type="number" placeholder="e.g. 800" value={filters.minPrice} onChange={(e) => updateFilter('minPrice', e.target.value)} />
                        </div>
                        <div className="filter-group">
                            <label>Max price</label>
                            <input type="number" placeholder="e.g. 1500" value={filters.maxPrice} onChange={(e) => updateFilter('maxPrice', e.target.value)} />
                        </div>
                        <div className="filter-group">
                            <label>Min beds</label>
                            <select value={filters.bedrooms} onChange={(e) => updateFilter('bedrooms', e.target.value)}>
                                <option value="">Any</option>
                                {options.bedroomCounts.map((n) => <option key={n} value={n}>{n}+</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label>Max beds</label>
                            <select value={filters.maxBedrooms} onChange={(e) => updateFilter('maxBedrooms', e.target.value)}>
                                <option value="">Any</option>
                                {options.bedroomCounts.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label>Property type</label>
                            <div className="multi-select" tabIndex={0}>
                                <div className="multi-select-display">
                                    {filters.propertyTypes.length === 0
                                        ? 'Any'
                                        : filters.propertyTypes.length === 1
                                            ? filters.propertyTypes[0]
                                            : `${filters.propertyTypes.length} selected`}
                                </div>
                                <div className="multi-select-dropdown">
                                    <button
                                        className="multi-select-clear"
                                        onClick={() => setFilters(prev => ({ ...prev, propertyTypes: [] }))}
                                    >
                                        Clear all
                                    </button>
                                    {options.propertyTypes.map((t) => (
                                        <label key={t} className="multi-select-option">
                                            <input
                                                type="checkbox"
                                                checked={filters.propertyTypes.includes(t)}
                                                onChange={(e) => {
                                                    const next = e.target.checked
                                                        ? [...filters.propertyTypes, t]
                                                        : filters.propertyTypes.filter((x) => x !== t)
                                                    setFilters((prev) => ({ ...prev, propertyTypes: next }))
                                                }}
                                            />
                                            {t}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="filter-group">
                            <label className="checkbox-label standalone">
                                <input
                                    type="checkbox"
                                    checked={filters.excludeShares}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, excludeShares: e.target.checked }))}
                                />
                                Exclude shares
                            </label>
                        </div>
                        <div className="filter-group filter-actions-group">
                            <button
                                className={`btn-more-filters ${showMoreFilters ? 'open' : ''} ${hasActiveExtraFilters(filters) ? 'has-active' : ''}`}
                                onClick={() => setShowMoreFilters(!showMoreFilters)}
                            >
                                More filters{extraFilterCount > 0 && ` (${extraFilterCount})`}
                                <span className="chevron">{showMoreFilters ? '\u25B2' : '\u25BC'}</span>
                            </button>
                            <button className="btn-clear" onClick={() => { setFilters(INITIAL_FILTERS); setShowMoreFilters(false) }}>Clear</button>
                        </div>
                    </div>

                    {showMoreFilters && (
                        <div className="filter-row extra-filters">
                            <div className="filter-group">
                                <label>Min baths</label>
                                <select value={filters.bathrooms} onChange={(e) => updateFilter('bathrooms', e.target.value)}>
                                    <option value="">Any</option>
                                    {options.bathroomCounts.map((n) => <option key={n} value={n}>{n}+</option>)}
                                </select>
                            </div>
                            <div className="filter-group">
                                <label>Source</label>
                                <select value={filters.source} onChange={(e) => updateFilter('source', e.target.value)}>
                                    <option value="">Any</option>
                                    {options.sources.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="filter-group">
                                <label>Furnishing</label>
                                <select value={filters.furnishType} onChange={(e) => updateFilter('furnishType', e.target.value)}>
                                    <option value="">Any</option>
                                    {options.furnishTypes.map((f) => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div className="filter-group">
                                <label>Max Council Tax</label>
                                <select value={filters.councilTax} onChange={(e) => updateFilter('councilTax', e.target.value)}>
                                    <option value="">Any</option>
                                    {'ABCDEFGH'.split('').map((b) => <option key={b} value={b}>Band {b}</option>)}
                                </select>
                            </div>
                            <div className="filter-group">
                                <label>Min sq ft</label>
                                <input type="number" placeholder="e.g. 400" value={filters.minSqFt} onChange={(e) => updateFilter('minSqFt', e.target.value)} />
                            </div>
                            <div className="filter-group">
                                <label>Max sq ft</label>
                                <input type="number" placeholder="e.g. 1000" value={filters.maxSqFt} onChange={(e) => updateFilter('maxSqFt', e.target.value)} />
                            </div>
                            <div className="filter-group">
                                <label>Available from</label>
                                <input type="date" value={filters.availableFrom} onChange={(e) => updateFilter('availableFrom', e.target.value)} />
                            </div>
                            <div className="filter-group">
                                <label>Available to</label>
                                <input type="date" value={filters.availableTo} onChange={(e) => updateFilter('availableTo', e.target.value)} />
                            </div>
                            <div className="filter-group">
                                <label>Distance from pin</label>
                                <select
                                    value={filters.pinRadius}
                                    onChange={(e) => {
                                        updateFilter('pinRadius', e.target.value)
                                        if (e.target.value) setShowPinPopup(true)
                                    }}
                                >
                                    <option value="">Off</option>
                                    <option value="1">Within 1 km</option>
                                    <option value="2">Within 2 km</option>
                                    <option value="5">Within 5 km</option>
                                    <option value="10">Within 10 km</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>

                {filters.pinLat && filters.pinLng && (
                    <div className="pin-active-bar">
                        <span>Pin: {parseFloat(filters.pinLat).toFixed(4)}, {parseFloat(filters.pinLng).toFixed(4)} — {filters.pinRadius}km radius</span>
                        <button className="pin-change-btn" onClick={() => setShowPinPopup(true)}>Change</button>
                        <button className="pin-change-btn" onClick={() => setFilters(prev => ({ ...prev, pinLat: '', pinLng: '', pinRadius: '' }))}>Remove</button>
                    </div>
                )}

                {isGridView && (
                    <div className="sort-bar">
                        <span className="result-count">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
                        <div className="sort-bar-right">
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                <option value="price-asc">Price: low to high</option>
                                <option value="price-desc">Price: high to low</option>
                                <option value="beds-desc">Bedrooms: most first</option>
                                <option value="beds-asc">Bedrooms: fewest first</option>
                                <option value="climbing-asc">Nearest climbing gym</option>
                                <option value="cinema-asc">Nearest cinema</option>
                                <option value="liveliness-desc">Most lively (amenities)</option>
                                <option value="commute-asc">Shortest commute to work</option>
                                <option value="custom-dist-asc">Nearest to custom location</option>
                            </select>
                        </div>
                    </div>
                )}

                {isGridView && sortBy === 'custom-dist-asc' && (
                    <div className="custom-coords-bar">
                        <span className="custom-coords-label">Sort by distance from:</span>
                        <input
                            type="number"
                            step="any"
                            placeholder="Latitude"
                            value={customLat}
                            onChange={(e) => setCustomLat(e.target.value)}
                            className="custom-coords-input"
                        />
                        <input
                            type="number"
                            step="any"
                            placeholder="Longitude"
                            value={customLng}
                            onChange={(e) => setCustomLng(e.target.value)}
                            className="custom-coords-input"
                        />
                        {customLat && customLng && (
                            <span className="custom-coords-hint">
                                Sorting by distance from ({parseFloat(customLat).toFixed(4)}, {parseFloat(customLng).toFixed(4)})
                            </span>
                        )}
                    </div>
                )}

                {isGridView && sortBy === 'commute-asc' && !workPinLat && (
                    <div className="custom-coords-bar">
                        <span className="custom-coords-label">Set your work location to sort by commute distance.</span>
                        <button className="btn-set-work-pin" onClick={() => setShowWorkPinPopup(true)}>
                            Set work location
                        </button>
                    </div>
                )}

                {workPinLat && workPinLng && (
                    <div className="pin-active-bar work-pin-bar">
                        <span>&#128188; Work: {parseFloat(workPinLat).toFixed(4)}, {parseFloat(workPinLng).toFixed(4)}</span>
                        {commuteStatus === 'loading' && <span className="commute-loading">Fetching commute times...</span>}
                        {commuteStatus === 'done' && <span className="commute-loaded">{Object.keys(commuteData).length} commute times loaded</span>}
                        {commuteStatus === 'error' && <span className="commute-error">Could not fetch commute times (using straight-line distance)</span>}
                        <button className="pin-change-btn" onClick={() => setShowWorkPinPopup(true)}>Change</button>
                        <button className="pin-change-btn" onClick={() => { setWorkPinLat(''); setWorkPinLng(''); setCommuteData({}); setCommuteStatus('idle') }}>Remove</button>
                    </div>
                )}

            {showWorkPinPopup && (
                <PinPickerPopup
                    lat={workPinLat}
                    lng={workPinLng}
                    radius={0}
                    onSubmit={(lat: number, lng: number) => {
                        setWorkPinLat(String(lat))
                        setWorkPinLng(String(lng))
                        setShowWorkPinPopup(false)
                        if (sortBy !== 'commute-asc') setSortBy('commute-asc')
                    }}
                    onClose={() => setShowWorkPinPopup(false)}
                />
            )}

            {showPinPopup && filters.pinRadius && (
                <PinPickerPopup
                    lat={filters.pinLat}
                    lng={filters.pinLng}
                    radius={Number(filters.pinRadius)}
                    onSubmit={(lat: number, lng: number) => {
                        setFilters(prev => ({
                            ...prev,
                            pinLat: String(lat),
                            pinLng: String(lng),
                        }))
                        setShowPinPopup(false)
                    }}
                    onClose={() => {
                        setShowPinPopup(false)
                        if (!filters.pinLat || !filters.pinLng) {
                            setFilters(prev => ({ ...prev, pinRadius: '' }))
                        }
                    }}
                />
            )}

            <main className="app-main">
                <Routes>
                    <Route path="/" element={
                        filtered.length === 0 ? (
                            <div className="no-results">No properties match your filters.</div>
                        ) : (
                            <>
                                <div className="listings-grid">
                                    {paged.map((listing, i) => (
                                        <PropertyCard
                                            key={listing.url || i}
                                            listing={listing}
                                            nearby={nearbyStatus === 'done' ? nearbyCounts[listing.url] : undefined}
                                            onSelect={setSelectedListing}
                                            valueRating={valueRatings[listing.url]}
                                            city={data?.city}
                                            commuteDistance={commuteData[listing.url]?.distance_m ?? (workPinLat && workPinLng && listing.latitude && listing.longitude ? haversineMetres(listing.latitude, listing.longitude, parseFloat(workPinLat), parseFloat(workPinLng)) : null)}
                                            commuteDuration={commuteData[listing.url]?.duration_s ?? null}
                                        />
                                    ))}
                                </div>
                                {page < totalPages && (
                                    <div className="pagination">
                                        <button className="btn-load-more" onClick={() => setPage(p => p + 1)}>
                                            Load more ({filtered.length - paged.length} remaining)
                                        </button>
                                        <span className="pagination-info">
                                            Showing {paged.length} of {filtered.length}
                                        </span>
                                    </div>
                                )}
                            </>
                        )
                    } />
                    <Route path="/map" element={
                        <MapView listings={filtered} nearbyCounts={nearbyCounts} />
                    } />
                    <Route path="/analytics" element={
                        <Suspense fallback={<div className="no-results">Loading analytics...</div>}>
                            <Analytics listings={filtered} nearbyCounts={nearbyCounts} onDrillDown={handleDrillDown} onSelectListing={setSelectedListing} />
                        </Suspense>
                    } />
                    <Route path="/alerts" element={
                        <Suspense fallback={<div className="no-results">Loading...</div>}>
                            {telegramConfigured ? (
                                <Alerts
                                    propertyTypes={options.propertyTypes}
                                    furnishTypes={options.furnishTypes}
                                    bedroomCounts={options.bedroomCounts}
                                    bathroomCounts={options.bathroomCounts}
                                    sources={options.sources}
                                />
                            ) : (
                                <TelegramSetup onComplete={() => setTelegramConfigured(true)} />
                            )}
                        </Suspense>
                    } />
                    <Route path="*" element={
                        <div className="not-found">
                            <h2>404</h2>
                            <p>Page not found</p>
                            <NavLink to="/" className="not-found-link">Back to listings</NavLink>
                        </div>
                    } />
                </Routes>
            </main>

            {selectedListing && (
                <PropertyPopup
                    listing={selectedListing}
                    nearby={nearbyCounts[selectedListing.url] ?? null}
                    onClose={() => setSelectedListing(null)}
                    valueRating={valueRatings[selectedListing.url]}
                />
            )}
        </>
    )
}
