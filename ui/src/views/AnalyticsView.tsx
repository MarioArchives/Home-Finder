import { Suspense, lazy } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useNearby } from '../contexts/DataContext'
import { useFilters } from '../contexts/FiltersContext'
import type { DrillDownFilter } from '../types/listing'
import type { OutletData } from './AppShell'

const Analytics = lazy(() => import('../components/Analytics/Analytics'))

const AnalyticsView = () => {
    const { filtered, selectListing } = useOutletContext<OutletData>()
    const { nearbyCounts } = useNearby()
    const { applyDrillDown } = useFilters()
    const navigate = useNavigate()

    const handleDrillDown = (drill: DrillDownFilter) => {
        applyDrillDown(drill)
        navigate('/')
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    return (
        <Suspense fallback={<div className="no-results">Loading analytics...</div>}>
            <Analytics
                listings={filtered}
                nearbyCounts={nearbyCounts}
                onDrillDown={handleDrillDown}
                onSelectListing={selectListing}
            />
        </Suspense>
    )
}

export default AnalyticsView
