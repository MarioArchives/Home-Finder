import type { FilterState } from '../../types/listing'

interface FilterOptions {
    propertyTypes: string[]
    sources: string[]
    furnishTypes: string[]
    bedroomCounts: number[]
    bathroomCounts: number[]
}

interface FilterToolbarProps {
    filters: FilterState
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>
    options: FilterOptions
    showMoreFilters: boolean
    setShowMoreFilters: (v: boolean) => void
    onSearchChange: (value: string) => void
    onShowPinPopup: () => void
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

const INITIAL_FILTERS: FilterState = {
    minPrice: '', maxPrice: '', bedrooms: '', maxBedrooms: '',
    bathrooms: '', propertyType: '', propertyTypes: [], source: '',
    furnishType: '', councilTax: '', minSqFt: '', maxSqFt: '',
    availableFrom: '', availableTo: '', excludeShares: false,
    pinLat: '', pinLng: '', pinRadius: '',
}

export default function FilterToolbar({
    filters, setFilters, options, showMoreFilters, setShowMoreFilters, onShowPinPopup,
}: FilterToolbarProps) {
    const updateFilter = (key: keyof FilterState, value: string) =>
        setFilters((prev) => ({ ...prev, [key]: value }))

    const extraFilterCount = [
        filters.bathrooms, filters.source, filters.furnishType, filters.councilTax,
        filters.minSqFt, filters.maxSqFt, filters.availableFrom, filters.availableTo, filters.pinRadius,
    ].filter(Boolean).length

    return (
        <>
            <div className="filters">
                <div className="filter-row primary-filters">
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
                                    if (e.target.value) onShowPinPopup()
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
                    <button className="pin-change-btn" onClick={onShowPinPopup}>Change</button>
                    <button className="pin-change-btn" onClick={() => setFilters(prev => ({ ...prev, pinLat: '', pinLng: '', pinRadius: '' }))}>Remove</button>
                </div>
            )}
        </>
    )
}
