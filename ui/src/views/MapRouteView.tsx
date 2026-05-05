import { useOutletContext } from 'react-router-dom'
import MapView from '../components/MapView/MapView'
import { useNearby } from '../contexts/DataContext'
import type { OutletData } from './AppShell'

const MapRouteView = () => {
    const { filtered } = useOutletContext<OutletData>()
    const { nearbyCounts } = useNearby()
    return <MapView listings={filtered} nearbyCounts={nearbyCounts} />
}

export default MapRouteView
