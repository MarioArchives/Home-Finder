import { Route, Routes } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './App.css'
import './shared/mapIcons/mapIcons'
import { ensureSourcesLoaded } from './shared/sources'
import { DataProvider } from './contexts/DataContext'
import { FiltersProvider } from './contexts/FiltersContext'
import AppShell from './views/AppShell'
import GridView from './views/GridView'
import MapRouteView from './views/MapRouteView'
import AnalyticsView from './views/AnalyticsView'
import AlertsView from './views/AlertsView'
import NotFoundView from './views/NotFoundView'

// Kick off the source registry fetch as early as possible so the first
// render of any badge / setup screen has live backend metadata available.
ensureSourcesLoaded()

const App = () => (
    <DataProvider>
        <FiltersProvider>
            <Routes>
                <Route element={<AppShell />}>
                    <Route path="/" element={<GridView />} />
                    <Route path="/map" element={<MapRouteView />} />
                    <Route path="/analytics" element={<AnalyticsView />} />
                    <Route path="/alerts" element={<AlertsView />} />
                    <Route path="*" element={<NotFoundView />} />
                </Route>
            </Routes>
        </FiltersProvider>
    </DataProvider>
)

export default App
