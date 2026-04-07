import { NavLink } from 'react-router-dom'
import type { AppHeaderProps } from './properties'

export default function AppHeader({
    city, listingType, filteredCount, totalCount, scrapedAt,
    nearbyStatus, onLoadAmenitiesFile, onReset,
}: AppHeaderProps) {
    return (
        <header className="app-topbar">
            <div className="toolbar-top">
                <div className="toolbar-title">
                    <h1>{city} — {listingType === 'rent' ? 'Rentals' : 'For Sale'}</h1>
                    <div className="stats">
                        {filteredCount} of {totalCount} properties
                        {scrapedAt && <> &middot; Scraped {new Date(scrapedAt).toLocaleDateString()}</>}
                        {nearbyStatus === 'loading' && <> &middot; Loading nearby places...</>}
                        {nearbyStatus === 'error' && (
                            <> &middot; <label className="inline-file-link">
                                <input type="file" accept=".json" onChange={onLoadAmenitiesFile} hidden />
                                Load amenities file
                            </label></>
                        )}
                        <span className="load-different-link" onClick={onReset}>Load different file</span>
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
    )
}
