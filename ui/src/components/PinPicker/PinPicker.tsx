import { useState } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet'
import '../../shared/mapIcons/mapIcons'

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
    useMapEvents({
        click: (e) => onClick(e.latlng.lat, e.latlng.lng),
    })
    return null
}

export function PinPickerPopup({ lat, lng, radius, onSubmit, onClose }: {
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

    return (
        <div className="pin-picker-overlay" onClick={onClose}>
            <div className="pin-picker-popup" onClick={(e) => e.stopPropagation()}>
                <div className="pin-picker-header">
                    <span className="pin-picker-label">
                        {hasPin
                            ? `Pin: ${pendingLat!.toFixed(4)}, ${pendingLng!.toFixed(4)}${radius > 0 ? ` — ${radius}km radius` : ''}`
                            : radius > 0 ? `Click the map to drop a pin (${radius}km radius)` : 'Click the map to set your location'}
                    </span>
                    <button className="pin-picker-close" onClick={onClose}>&times;</button>
                </div>
                <MapContainer center={center} zoom={12} className="pin-picker-map">
                    <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <ClickHandler onClick={(lat, lng) => { setPendingLat(lat); setPendingLng(lng) }} />
                    {hasPin && (
                        <>
                            <Marker position={[pendingLat!, pendingLng!]} />
                            {radius > 0 && (
                                <Circle
                                    center={[pendingLat!, pendingLng!]}
                                    radius={radius * 1000}
                                    pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 2 }}
                                />
                            )}
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

export function PinPickerInner({ onConfirm }: { onConfirm: (lat: number, lng: number) => void }) {
    const [pendingLat, setPendingLat] = useState<number | null>(null)
    const [pendingLng, setPendingLng] = useState<number | null>(null)
    const hasPin = pendingLat != null && pendingLng != null

    return (
        <>
            <MapContainer center={[53.48, -2.24]} zoom={12} className="pin-picker-map">
                <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickHandler onClick={(lat, lng) => { setPendingLat(lat); setPendingLng(lng) }} />
                {hasPin && <Marker position={[pendingLat!, pendingLng!]} />}
            </MapContainer>
            {hasPin && (
                <div className="pin-picker-footer">
                    <span className="pin-picker-coords">{pendingLat!.toFixed(4)}, {pendingLng!.toFixed(4)}</span>
                    <button className="pin-picker-submit" onClick={() => onConfirm(pendingLat!, pendingLng!)}>
                        Add pin
                    </button>
                </div>
            )}
        </>
    )
}
