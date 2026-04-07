import type { SortBarProps } from './properties'

export default function SortBar({
    sortBy, setSortBy, resultCount,
    customLat, setCustomLat, customLng, setCustomLng,
    workPinLat, onSetWorkPin,
}: SortBarProps) {
    return (
        <>
            <div className="sort-bar">
                <span className="result-count">{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
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

            {sortBy === 'custom-dist-asc' && (
                <div className="custom-coords-bar">
                    <span className="custom-coords-label">Sort by distance from:</span>
                    <input type="number" step="any" placeholder="Latitude" value={customLat} onChange={(e) => setCustomLat(e.target.value)} className="custom-coords-input" />
                    <input type="number" step="any" placeholder="Longitude" value={customLng} onChange={(e) => setCustomLng(e.target.value)} className="custom-coords-input" />
                    {customLat && customLng && <span className="custom-coords-hint">Sorting by distance from ({parseFloat(customLat).toFixed(4)}, {parseFloat(customLng).toFixed(4)})</span>}
                </div>
            )}

            {sortBy === 'commute-asc' && !workPinLat && (
                <div className="custom-coords-bar">
                    <span className="custom-coords-label">Set your work location to sort by commute distance.</span>
                    <button className="btn-set-work-pin" onClick={onSetWorkPin}>Set work location</button>
                </div>
            )}
        </>
    )
}
