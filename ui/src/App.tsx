import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { haversineMetres } from './shared/utils/utils'
import { useListingsData } from './hooks/useListingsData'
import { useFilteredListings } from './hooks/useFilteredListings'
import PropertyCard from './components/PropertyCard/PropertyCard'
import MapView from './components/MapView/MapView'
import PropertyPopup from './components/Analytics/components/PropertyPopup/PropertyPopup'
import SetupWizard from './components/SetupWizard/SetupWizard'
import SetupProgress from './components/SetupProgress/SetupProgress'
import AppHeader from './components/AppHeader/AppHeader'
import FilterToolbar from './components/FilterToolbar/FilterToolbar'
import SortBar from './components/SortBar/SortBar'
import WorkPinBar from './components/WorkPinBar/WorkPinBar'
import CustomPinsBar from './components/CustomPinsBar/CustomPinsBar'
import { PinPickerPopup } from './components/PinPicker/PinPicker'
import './shared/mapIcons/mapIcons'
import type { Listing, FilterState, DrillDownFilter } from './types/listing'

const Analytics = lazy(() => import('./components/Analytics/Analytics'))
const Alerts = lazy(() => import('./components/Alerts/Alerts'))
const TelegramSetup = lazy(() => import('./components/TelegramSetup/TelegramSetup'))

const INITIAL_FILTERS: FilterState = {
    search: '', minPrice: '', maxPrice: '', bedrooms: '', maxBedrooms: '',
    bathrooms: '', propertyType: '', propertyTypes: [], source: '',
    furnishType: '', councilTax: '', minSqFt: '', maxSqFt: '',
    availableFrom: '', availableTo: '', excludeShares: false,
    pinLat: '', pinLng: '', pinRadius: '',
}

const PAGE_SIZE = 24

export default function App() {
    const navigate = useNavigate()
    const location = useLocation()
    const isGridView = location.pathname === '/'

    // ---- Data loading hook ----
    const ld = useListingsData()

    // ---- UI state ----
    const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
    const [sortBy, setSortBy] = useState('price-asc')
    const [page, setPage] = useState(1)
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null)
    const [showMoreFilters, setShowMoreFilters] = useState(false)
    const [customLat, setCustomLat] = useState('')
    const [customLng, setCustomLng] = useState('')
    const [showPinPopup, setShowPinPopup] = useState(false)
    const [showWorkPinPopup, setShowWorkPinPopup] = useState(false)
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

    // ---- Filtering + sorting hook ----
    const { filtered, options, valueRatings } = useFilteredListings({
        listings: ld.listings, filters, debouncedSearch, sortBy,
        nearbyCounts: ld.nearbyCounts, customLat, customLng,
        commuteData: ld.commuteData, workPinLat: ld.workPinLat, workPinLng: ld.workPinLng,
    })

    // ---- Pagination ----
    useEffect(() => { setPage(1) }, [filtered])
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
    const paged = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])

    // ---- Callbacks ----
    const updateSearchFilter = useCallback((value: string) => {
        setFilters(prev => ({ ...prev, search: value }))
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 300)
    }, [])

    const handleDrillDown = useCallback((drillFilter: DrillDownFilter) => {
        setFilters({ ...INITIAL_FILTERS, ...drillFilter })
        setPage(1)
        navigate('/')
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }, [navigate])

    // ---- Early returns ----
    if (ld.appStatus === 'loading') return <div className="load-screen"><p>Loading...</p></div>
    if (ld.appStatus === 'setup_needed') return <SetupWizard onStarted={() => ld.setAppStatus('scraping')} />
    if (ld.appStatus === 'scraping' || ld.appStatus === 'amenities') return <SetupProgress onComplete={() => ld.setAppStatus('ready')} onTelegramConfigured={() => ld.setTelegramConfigured(true)} />
    if (!ld.data) return (
        <div className="load-screen">
            <h2>Property Listings Viewer</h2>
            <p>Load a scraped listings JSON file to get started.</p>
            <div className="file-input-wrapper">
                <input type="file" id="file-input" accept=".json" onChange={ld.handleFileLoad} />
                <label htmlFor="file-input">Choose JSON file</label>
            </div>
        </div>
    )

    return (
        <>
            <AppHeader
                city={ld.data.city} listingType={ld.data.listing_type}
                filteredCount={filtered.length}
                totalCount={new Set(ld.listings.map((l) => l.url)).size}
                scrapedAt={ld.data.scraped_at}
                nearbyStatus={ld.nearbyStatus}
                onLoadAmenitiesFile={ld.handleAmenitiesFileLoad}
                onReset={() => { ld.setData(null); setFilters(INITIAL_FILTERS); ld.setNearbyCounts({}); ld.setNearbyStatus('idle') }}
            />

            <FilterToolbar
                filters={filters} setFilters={setFilters} options={options}
                showMoreFilters={showMoreFilters} setShowMoreFilters={setShowMoreFilters}
                onSearchChange={updateSearchFilter} onShowPinPopup={() => setShowPinPopup(true)}
            />

            {isGridView && (
                <SortBar
                    sortBy={sortBy} setSortBy={setSortBy} resultCount={filtered.length}
                    customLat={customLat} setCustomLat={setCustomLat}
                    customLng={customLng} setCustomLng={setCustomLng}
                    workPinLat={ld.workPinLat} onSetWorkPin={() => setShowWorkPinPopup(true)}
                />
            )}

            <WorkPinBar
                workPinLat={ld.workPinLat} workPinLng={ld.workPinLng}
                commuteStatus={ld.commuteStatus} commuteCount={Object.keys(ld.commuteData).length}
                onChangePin={() => setShowWorkPinPopup(true)}
                onRemovePin={() => { ld.setWorkPinLat(''); ld.setWorkPinLng(''); ld.setCommuteData({}); ld.setCommuteStatus('idle') }}
            />

            <CustomPinsBar customPins={ld.customPins} setCustomPins={ld.setCustomPins} />

            {/* ---- Popups ---- */}
            {showWorkPinPopup && (
                <PinPickerPopup lat={ld.workPinLat} lng={ld.workPinLng} radius={0}
                    onSubmit={(lat, lng) => { ld.setWorkPinLat(String(lat)); ld.setWorkPinLng(String(lng)); setShowWorkPinPopup(false); if (sortBy !== 'commute-asc') setSortBy('commute-asc') }}
                    onClose={() => setShowWorkPinPopup(false)} />
            )}

            {showPinPopup && filters.pinRadius && (
                <PinPickerPopup lat={filters.pinLat} lng={filters.pinLng} radius={Number(filters.pinRadius)}
                    onSubmit={(lat, lng) => { setFilters(prev => ({ ...prev, pinLat: String(lat), pinLng: String(lng) })); setShowPinPopup(false) }}
                    onClose={() => { setShowPinPopup(false); if (!filters.pinLat || !filters.pinLng) setFilters(prev => ({ ...prev, pinRadius: '' })) }} />
            )}

            {/* ---- Main content ---- */}
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
                                            nearby={ld.nearbyStatus === 'done' ? ld.nearbyCounts[listing.url] : undefined}
                                            onSelect={setSelectedListing}
                                            valueRating={valueRatings[listing.url]}
                                            city={ld.data?.city}
                                            commuteDistance={ld.commuteData[listing.url]?.distance_m ?? (ld.workPinLat && ld.workPinLng && listing.latitude && listing.longitude ? haversineMetres(listing.latitude, listing.longitude, parseFloat(ld.workPinLat), parseFloat(ld.workPinLng)) : null)}
                                            commuteDuration={ld.commuteData[listing.url]?.duration_s ?? null}
                                            pinDistances={ld.pinDistancesMap[listing.url]}
                                        />
                                    ))}
                                </div>
                                {page < totalPages && (
                                    <div className="pagination">
                                        <button className="btn-load-more" onClick={() => setPage(p => p + 1)}>
                                            Load more ({filtered.length - paged.length} remaining)
                                        </button>
                                        <span className="pagination-info">Showing {paged.length} of {filtered.length}</span>
                                    </div>
                                )}
                            </>
                        )
                    } />
                    <Route path="/map" element={<MapView listings={filtered} nearbyCounts={ld.nearbyCounts} />} />
                    <Route path="/analytics" element={
                        <Suspense fallback={<div className="no-results">Loading analytics...</div>}>
                            <Analytics listings={filtered} nearbyCounts={ld.nearbyCounts} onDrillDown={handleDrillDown} onSelectListing={setSelectedListing} />
                        </Suspense>
                    } />
                    <Route path="/alerts" element={
                        <Suspense fallback={<div className="no-results">Loading...</div>}>
                            {ld.telegramConfigured
                                ? <Alerts propertyTypes={options.propertyTypes} furnishTypes={options.furnishTypes} bedroomCounts={options.bedroomCounts} bathroomCounts={options.bathroomCounts} sources={options.sources} />
                                : <TelegramSetup onComplete={() => ld.setTelegramConfigured(true)} />}
                        </Suspense>
                    } />
                    <Route path="*" element={<div className="not-found"><h2>404</h2><p>Page not found</p><NavLink to="/" className="not-found-link">Back to listings</NavLink></div>} />
                </Routes>
            </main>

            {selectedListing && (
                <PropertyPopup listing={selectedListing} nearby={ld.nearbyCounts[selectedListing.url] ?? null} onClose={() => setSelectedListing(null)} valueRating={valueRatings[selectedListing.url]} />
            )}
        </>
    )
}
