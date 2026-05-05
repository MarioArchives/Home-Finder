import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PropertyCard from '../components/PropertyCard/PropertyCard'
import SortBar from '../components/SortBar/SortBar'
import { PAGE_SIZE } from '../config/constants'
import { useListings, useNearby, useWorkPin } from '../contexts/DataContext'
import { useFilters } from '../contexts/FiltersContext'
import { useCustomPins } from '../contexts/DataContext'
import { haversineMetres } from '../shared/utils/utils'
import type { OutletData } from './AppShell'

const GridView = () => {
    const { filtered, valueRatings, selectListing, openWorkPinPopup } = useOutletContext<OutletData>()
    const { data } = useListings()
    const { nearbyCounts, nearbyStatus } = useNearby()
    const { workPinLat, workPinLng, commuteData } = useWorkPin()
    const { pinDistancesMap } = useCustomPins()
    const filters = useFilters()
    const [page, setPage] = useState(1)

    useEffect(() => { setPage(1) }, [filtered])

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
    const paged = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])

    return (
        <>
            <SortBar
                sortBy={filters.sortBy}
                setSortBy={filters.setSortBy}
                resultCount={filtered.length}
                customLat={filters.customLat}
                setCustomLat={filters.setCustomLat}
                customLng={filters.customLng}
                setCustomLng={filters.setCustomLng}
                workPinLat={workPinLat}
                onSetWorkPin={openWorkPinPopup}
            />
            {filtered.length === 0 ? (
                <div className="no-results">No properties match your filters.</div>
            ) : (
                <>
                    <div className="listings-grid">
                        {paged.map((listing, i) => (
                            <PropertyCard
                                key={listing.url || i}
                                listing={listing}
                                nearby={nearbyStatus === 'done' ? nearbyCounts[listing.url] : undefined}
                                onSelect={selectListing}
                                valueRating={valueRatings[listing.url]}
                                city={data?.city}
                                commuteDistance={commuteData[listing.url]?.distance_m ?? (workPinLat && workPinLng && listing.latitude && listing.longitude
                                    ? haversineMetres(listing.latitude, listing.longitude, parseFloat(workPinLat), parseFloat(workPinLng))
                                    : null)}
                                commuteDuration={commuteData[listing.url]?.duration_s ?? null}
                                pinDistances={pinDistancesMap[listing.url]}
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
            )}
        </>
    )
}

export default GridView
