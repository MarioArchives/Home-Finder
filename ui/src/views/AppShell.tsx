import { useState, type ChangeEvent } from 'react'
import { Outlet } from 'react-router-dom'
import AppHeader from '../components/AppHeader/AppHeader'
import FilterToolbar from '../components/FilterToolbar/FilterToolbar'
import WorkPinBar from '../components/WorkPinBar/WorkPinBar'
import CustomPinsBar from '../components/CustomPinsBar/CustomPinsBar'
import CronFooter from '../components/CronFooter/CronFooter'
import PropertyPopup from '../components/Analytics/components/PropertyPopup/PropertyPopup'
import SetupWizard from '../components/SetupWizard/SetupWizard'
import SetupProgress from '../components/SetupProgress/SetupProgress'
import { PinPickerPopup } from '../components/PinPicker/PinPicker'
import { useAppStatus, useCustomPins, useListings, useNearby, useWorkPin } from '../contexts/DataContext'
import { useFilters } from '../contexts/FiltersContext'
import { useFilteredListings, type FilterOptions } from '../hooks/useFilteredListings'
import type { Listing } from '../types/listing'

export interface OutletData {
    filtered: Listing[]
    options: FilterOptions
    valueRatings: Record<string, string>
    selectListing: (l: Listing) => void
    openWorkPinPopup: () => void
}

const AppShell = () => {
    const { appStatus, setAppStatus, setTelegramConfigured } = useAppStatus()
    const { data, setData, listings, handleFileLoad } = useListings()
    const { nearbyCounts, setNearbyCounts, nearbyStatus, setNearbyStatus, handleAmenitiesFileLoad } = useNearby()
    const { workPinLat, setWorkPinLat, workPinLng, setWorkPinLng,
        commuteData, setCommuteData, commuteStatus, setCommuteStatus } = useWorkPin()
    const { customPins, setCustomPins } = useCustomPins()
    const filters = useFilters()

    const [selectedListing, setSelectedListing] = useState<Listing | null>(null)
    const [showMoreFilters, setShowMoreFilters] = useState(false)
    const [showPinPopup, setShowPinPopup] = useState(false)
    const [showWorkPinPopup, setShowWorkPinPopup] = useState(false)

    const { filtered, options, valueRatings } = useFilteredListings({
        listings,
        filters: filters.filters,
        debouncedSearch: filters.debouncedSearch,
        sortBy: filters.sortBy,
        nearbyCounts,
        customLat: filters.customLat,
        customLng: filters.customLng,
        commuteData,
        workPinLat,
        workPinLng,
    })

    if (appStatus === 'loading') return <div className="load-screen"><p>Loading...</p></div>
    if (appStatus === 'setup_needed') return <SetupWizard onStarted={() => setAppStatus('scraping')} />
    if (appStatus === 'scraping' || appStatus === 'amenities') {
        return <SetupProgress onComplete={() => setAppStatus('ready')} onTelegramConfigured={() => setTelegramConfigured(true)} />
    }
    if (!data) return (
        <div className="load-screen">
            <h2>Property Listings Viewer</h2>
            <p>Load a scraped listings JSON file to get started.</p>
            <div className="file-input-wrapper">
                <input type="file" id="file-input" accept=".json" onChange={handleFileLoad} />
                <label htmlFor="file-input">Choose JSON file</label>
            </div>
        </div>
    )

    const onLoadAmenitiesFile = (e: ChangeEvent<HTMLInputElement>) => handleAmenitiesFileLoad(e)

    const onReset = () => {
        setData(null)
        filters.resetFilters()
        setNearbyCounts({})
        setNearbyStatus('idle')
    }

    const onRemoveWorkPin = () => {
        setWorkPinLat('')
        setWorkPinLng('')
        setCommuteData({})
        setCommuteStatus('idle')
    }

    const outletValue: OutletData = {
        filtered, options, valueRatings,
        selectListing: setSelectedListing,
        openWorkPinPopup: () => setShowWorkPinPopup(true),
    }

    return (
        <>
            <AppHeader
                city={data.city}
                listingType={data.listing_type}
                filteredCount={filtered.length}
                totalCount={new Set(listings.map(l => l.url)).size}
                scrapedAt={data.scraped_at}
                nearbyStatus={nearbyStatus}
                onLoadAmenitiesFile={onLoadAmenitiesFile}
                onReset={onReset}
            />

            <FilterToolbar
                filters={filters.filters}
                setFilters={filters.setFilters}
                options={options}
                showMoreFilters={showMoreFilters}
                setShowMoreFilters={setShowMoreFilters}
                onSearchChange={filters.updateSearch}
                onShowPinPopup={() => setShowPinPopup(true)}
            />

            <WorkPinBar
                workPinLat={workPinLat}
                workPinLng={workPinLng}
                commuteStatus={commuteStatus}
                commuteCount={Object.keys(commuteData).length}
                onChangePin={() => setShowWorkPinPopup(true)}
                onRemovePin={onRemoveWorkPin}
            />

            <CustomPinsBar customPins={customPins} setCustomPins={setCustomPins} />

            {showWorkPinPopup && (
                <PinPickerPopup
                    lat={workPinLat} lng={workPinLng} radius={0}
                    onSubmit={(lat, lng) => {
                        setWorkPinLat(String(lat))
                        setWorkPinLng(String(lng))
                        setShowWorkPinPopup(false)
                        if (filters.sortBy !== 'commute-asc') filters.setSortBy('commute-asc')
                    }}
                    onClose={() => setShowWorkPinPopup(false)}
                />
            )}

            {showPinPopup && filters.filters.pinRadius && (
                <PinPickerPopup
                    lat={filters.filters.pinLat}
                    lng={filters.filters.pinLng}
                    radius={Number(filters.filters.pinRadius)}
                    onSubmit={(lat, lng) => {
                        filters.setFilters(prev => ({ ...prev, pinLat: String(lat), pinLng: String(lng) }))
                        setShowPinPopup(false)
                    }}
                    onClose={() => {
                        setShowPinPopup(false)
                        if (!filters.filters.pinLat || !filters.filters.pinLng) {
                            filters.setFilters(prev => ({ ...prev, pinRadius: '' }))
                        }
                    }}
                />
            )}

            <main className="app-main">
                <Outlet context={outletValue} />
            </main>

            {selectedListing && (
                <PropertyPopup
                    listing={selectedListing}
                    nearby={nearbyCounts[selectedListing.url] ?? null}
                    onClose={() => setSelectedListing(null)}
                    valueRating={valueRatings[selectedListing.url]}
                />
            )}

            <CronFooter />
        </>
    )
}

export default AppShell
