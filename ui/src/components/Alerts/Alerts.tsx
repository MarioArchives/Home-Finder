import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet'
import type { Alert } from '../../types/listing'
import '../../shared/mapIcons/mapIcons'
import './Alerts.css'

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
                            ? `Pin: ${pendingLat!.toFixed(4)}, ${pendingLng!.toFixed(4)} — ${radius}km radius`
                            : `Click the map to drop a pin (${radius}km radius)`}
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
                            <Circle
                                center={[pendingLat!, pendingLng!]}
                                radius={radius * 1000}
                                pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 2 }}
                            />
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

interface AlertsProps {
    propertyTypes: string[]
    furnishTypes: string[]
    bedroomCounts: number[]
    bathroomCounts: number[]
    sources: string[]
}

const COUNCIL_TAX_BANDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export default function Alerts({ propertyTypes, furnishTypes, bedroomCounts, bathroomCounts, sources }: AlertsProps) {
    const [alerts, setAlerts] = useState<Alert[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [testing, setTesting] = useState<string | null>(null)
    const [testResult, setTestResult] = useState<{ id: string; matches: number; urls: string[] } | null>(null)

    // Form state
    const [name, setName] = useState('')
    const [minPrice, setMinPrice] = useState('')
    const [maxPrice, setMaxPrice] = useState('')
    const [minBedrooms, setMinBedrooms] = useState('')
    const [minBathrooms, setMinBathrooms] = useState('')
    const [source, setSource] = useState('')
    const [selectedTaxBands, setSelectedTaxBands] = useState<string[]>([])
    const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>([])
    const [furnishType, setFurnishType] = useState('')
    const [minSqFt, setMinSqFt] = useState('')
    const [maxSqFt, setMaxSqFt] = useState('')
    const [availableFrom, setAvailableFrom] = useState('')
    const [availableTo, setAvailableTo] = useState('')
    const [pinLat, setPinLat] = useState('')
    const [pinLng, setPinLng] = useState('')
    const [pinRadius, setPinRadius] = useState('')
    const [showPinPopup, setShowPinPopup] = useState(false)
    const [excludeShares, setExcludeShares] = useState(false)
    const [search, setSearch] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetch('/api/alerts')
            .then(r => r.json())
            .then(setAlerts)
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    const resetForm = () => {
        setName('')
        setMinPrice('')
        setMaxPrice('')
        setMinBedrooms('')
        setMinBathrooms('')
        setSource('')
        setSelectedTaxBands([])
        setSelectedPropertyTypes([])
        setFurnishType('')
        setMinSqFt('')
        setMaxSqFt('')
        setAvailableFrom('')
        setAvailableTo('')
        setPinLat('')
        setPinLng('')
        setPinRadius('')
        setShowPinPopup(false)
        setExcludeShares(false)
        setSearch('')
    }

    const handleCreate = async () => {
        if (!name.trim()) return
        setSaving(true)
        try {
            const res = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    minPrice: minPrice ? Number(minPrice) : null,
                    maxPrice: maxPrice ? Number(maxPrice) : null,
                    minBedrooms: minBedrooms ? Number(minBedrooms) : null,
                    minBathrooms: minBathrooms ? Number(minBathrooms) : null,
                    source: source || null,
                    councilTaxBands: selectedTaxBands.length > 0 ? selectedTaxBands : null,
                    propertyTypes: selectedPropertyTypes.length > 0 ? selectedPropertyTypes : null,
                    furnishType: furnishType || null,
                    minSqFt: minSqFt ? Number(minSqFt) : null,
                    maxSqFt: maxSqFt ? Number(maxSqFt) : null,
                    availableFrom: availableFrom || null,
                    availableTo: availableTo || null,
                    pinLat: pinLat ? Number(pinLat) : null,
                    pinLng: pinLng ? Number(pinLng) : null,
                    pinRadius: pinRadius ? Number(pinRadius) : null,
                    excludeShares,
                    search: search.trim(),
                    createdAt: new Date().toISOString(),
                }),
            })
            const created = await res.json()
            setAlerts(prev => [...prev, created])
            resetForm()
            setShowForm(false)
        } catch {
            alert('Failed to save alert')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
            setAlerts(prev => prev.filter(a => a.id !== id))
        } catch {
            alert('Failed to delete alert')
        }
    }

    const handleTest = async (id: string) => {
        setTesting(id)
        setTestResult(null)
        try {
            const res = await fetch(`/api/alerts/${id}/test`, { method: 'POST' })
            const data = await res.json()
            setTestResult({ id, matches: data.matches, urls: data.urls })
        } catch {
            alert('Failed to test alert')
        } finally {
            setTesting(null)
        }
    }

    const toggleTaxBand = (band: string) => {
        setSelectedTaxBands(prev =>
            prev.includes(band) ? prev.filter(b => b !== band) : [...prev, band]
        )
    }

    const togglePropertyType = (type: string) => {
        setSelectedPropertyTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        )
    }

    if (loading) {
        return <div className="alerts-loading">Loading alerts...</div>
    }

    return (
        <div className="alerts-container">
            <div className="alerts-header">
                <div>
                    <h2>Listing Alerts</h2>
                    <p className="alerts-description">
                        Set up alerts with your criteria. The app checks daily at a random time for new listings matching your parameters and sends notifications via Telegram.
                    </p>
                </div>
                <button className="btn-new-alert" onClick={() => setShowForm(!showForm)}>
                    {showForm ? 'Cancel' : '+ New Alert'}
                </button>
            </div>

            {showForm && (
                <div className="alert-form">
                    <div className="alert-form-grid">
                        <div className="form-group form-group-wide">
                            <label>Alert name *</label>
                            <input
                                type="text"
                                placeholder="e.g. 2-bed under 1200"
                                value={name}
                                onChange={e => setName(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Min price (pcm)</label>
                            <input
                                type="number"
                                placeholder="e.g. 800"
                                value={minPrice}
                                onChange={e => setMinPrice(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Max price (pcm)</label>
                            <input
                                type="number"
                                placeholder="e.g. 1500"
                                value={maxPrice}
                                onChange={e => setMaxPrice(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Min bedrooms</label>
                            <select value={minBedrooms} onChange={e => setMinBedrooms(e.target.value)}>
                                <option value="">Any</option>
                                {bedroomCounts.map(n => <option key={n} value={n}>{n}+</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Min bathrooms</label>
                            <select value={minBathrooms} onChange={e => setMinBathrooms(e.target.value)}>
                                <option value="">Any</option>
                                {bathroomCounts.map(n => <option key={n} value={n}>{n}+</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Source</label>
                            <select value={source} onChange={e => setSource(e.target.value)}>
                                <option value="">Any</option>
                                {sources.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Furnishing</label>
                            <select value={furnishType} onChange={e => setFurnishType(e.target.value)}>
                                <option value="">Any</option>
                                {furnishTypes.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Min sq ft</label>
                            <input
                                type="number"
                                placeholder="e.g. 400"
                                value={minSqFt}
                                onChange={e => setMinSqFt(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Max sq ft</label>
                            <input
                                type="number"
                                placeholder="e.g. 1000"
                                value={maxSqFt}
                                onChange={e => setMaxSqFt(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Available from</label>
                            <input
                                type="date"
                                value={availableFrom}
                                onChange={e => setAvailableFrom(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Available to</label>
                            <input
                                type="date"
                                value={availableTo}
                                onChange={e => setAvailableTo(e.target.value)}
                            />
                        </div>
                        <div className="form-group form-group-wide">
                            <label>Search keywords</label>
                            <input
                                type="text"
                                placeholder="e.g. parking, garden"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Distance from pin</label>
                            <select
                                value={pinRadius}
                                onChange={e => {
                                    setPinRadius(e.target.value)
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
                        {pinLat && pinLng && (
                            <div className="form-group form-group-wide pin-active-bar-inline">
                                <span>Pin: {parseFloat(pinLat).toFixed(4)}, {parseFloat(pinLng).toFixed(4)} — {pinRadius}km radius</span>
                                <button type="button" className="pin-change-btn" onClick={() => setShowPinPopup(true)}>Change</button>
                                <button type="button" className="pin-change-btn" onClick={() => { setPinLat(''); setPinLng(''); setPinRadius('') }}>Remove</button>
                            </div>
                        )}
                        <div className="form-group form-group-wide">
                            <label>Council tax bands</label>
                            <div className="band-toggles">
                                {COUNCIL_TAX_BANDS.map(band => (
                                    <button
                                        key={band}
                                        className={`band-toggle ${selectedTaxBands.includes(band) ? 'active' : ''}`}
                                        onClick={() => toggleTaxBand(band)}
                                    >
                                        {band}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {propertyTypes.length > 0 && (
                            <div className="form-group form-group-wide">
                                <label>Property types</label>
                                <div className="property-type-toggles">
                                    {propertyTypes.map(type => (
                                        <button
                                            key={type}
                                            className={`type-toggle ${selectedPropertyTypes.includes(type) ? 'active' : ''}`}
                                            onClick={() => togglePropertyType(type)}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="form-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={excludeShares}
                                    onChange={e => setExcludeShares(e.target.checked)}
                                />
                                Exclude shares
                            </label>
                        </div>
                    </div>
                    <div className="alert-form-actions">
                        <button className="btn-save-alert" onClick={handleCreate} disabled={!name.trim() || saving}>
                            {saving ? 'Saving...' : 'Save Alert'}
                        </button>
                    </div>

                    {showPinPopup && pinRadius && (
                        <PinPickerPopup
                            lat={pinLat}
                            lng={pinLng}
                            radius={Number(pinRadius)}
                            onSubmit={(lat: number, lng: number) => {
                                setPinLat(String(lat))
                                setPinLng(String(lng))
                                setShowPinPopup(false)
                            }}
                            onClose={() => {
                                setShowPinPopup(false)
                                if (!pinLat || !pinLng) {
                                    setPinRadius('')
                                }
                            }}
                        />
                    )}
                </div>
            )}

            {alerts.length === 0 ? (
                <div className="alerts-empty">
                    <p>No alerts configured yet.</p>
                    <p>Create an alert to get daily Telegram notifications when new listings match your criteria.</p>
                </div>
            ) : (
                <div className="alerts-list">
                    {alerts.map(a => (
                        <div key={a.id} className="alert-card">
                            <div className="alert-card-header">
                                <h3>{a.name}</h3>
                                <button className="btn-delete-alert" onClick={() => handleDelete(a.id)} title="Delete alert">
                                    &times;
                                </button>
                            </div>
                            <div className="alert-card-criteria">
                                {a.minPrice != null && (
                                    <span className="alert-tag">Min £{a.minPrice} pcm</span>
                                )}
                                {a.maxPrice != null && (
                                    <span className="alert-tag">Max £{a.maxPrice} pcm</span>
                                )}
                                {a.minBedrooms != null && (
                                    <span className="alert-tag">{a.minBedrooms}+ beds</span>
                                )}
                                {a.minBathrooms != null && (
                                    <span className="alert-tag">{a.minBathrooms}+ baths</span>
                                )}
                                {a.source && (
                                    <span className="alert-tag">{a.source}</span>
                                )}
                                {a.councilTaxBands && a.councilTaxBands.length > 0 && (
                                    <span className="alert-tag">Tax: {a.councilTaxBands.join(', ')}</span>
                                )}
                                {a.propertyTypes && a.propertyTypes.length > 0 && (
                                    <span className="alert-tag">{a.propertyTypes.join(', ')}</span>
                                )}
                                {a.furnishType && (
                                    <span className="alert-tag">{a.furnishType}</span>
                                )}
                                {a.minSqFt != null && (
                                    <span className="alert-tag">Min {a.minSqFt} sq ft</span>
                                )}
                                {a.maxSqFt != null && (
                                    <span className="alert-tag">Max {a.maxSqFt} sq ft</span>
                                )}
                                {a.availableFrom && (
                                    <span className="alert-tag">From {a.availableFrom}</span>
                                )}
                                {a.availableTo && (
                                    <span className="alert-tag">Until {a.availableTo}</span>
                                )}
                                {a.pinRadius != null && (
                                    <span className="alert-tag">Within {a.pinRadius}km of pin</span>
                                )}
                                {a.excludeShares && (
                                    <span className="alert-tag">No shares</span>
                                )}
                                {a.search && (
                                    <span className="alert-tag">"{a.search}"</span>
                                )}
                            </div>
                            <div className="alert-card-footer">
                                <span>Created {new Date(a.createdAt).toLocaleDateString()}</span>
                                <button
                                    className="btn-test-alert"
                                    onClick={() => handleTest(a.id)}
                                    disabled={testing === a.id}
                                >
                                    {testing === a.id ? 'Sending...' : 'Test on Telegram'}
                                </button>
                            </div>
                            {testResult?.id === a.id && (
                                <div className="alert-test-result">
                                    <strong>{testResult.matches} match{testResult.matches !== 1 ? 'es' : ''}</strong> sent to Telegram
                                    {testResult.urls.length > 0 && (
                                        <ul className="alert-test-urls">
                                            {testResult.urls.map(url => (
                                                <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
