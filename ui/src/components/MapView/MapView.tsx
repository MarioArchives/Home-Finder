import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { formatDistance } from '../../shared/utils/utils'
import '../../shared/mapIcons/mapIcons'
import type { MapViewProps } from './properties'
import type { Listing } from '../../types/listing'
import './MapView.css'

function FitBounds({ listings }: { listings: Listing[] }) {
  const map = useMap()
  useEffect(() => {
    const points = listings
      .filter((l) => l.latitude && l.longitude)
      .map((l) => [l.latitude!, l.longitude!] as [number, number])
    if (points.length > 0) {
      map.fitBounds(points, { padding: [30, 30] })
    }
  }, [listings, map])
  return null
}

export default function MapView({ listings, nearbyCounts }: MapViewProps) {
  const withCoords = listings.filter((l) => l.latitude && l.longitude)

  if (withCoords.length === 0) {
    return <div className="no-results">No properties with location data to display on map.</div>
  }

  const center: [number, number] = [
    withCoords.reduce((s, l) => s + l.latitude!, 0) / withCoords.length,
    withCoords.reduce((s, l) => s + l.longitude!, 0) / withCoords.length,
  ]

  return (
    <div className="map-container">
      <MapContainer center={center} zoom={13} className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds listings={withCoords} />
        {withCoords.map((listing, i) => (
          <Marker key={listing.url || i} position={[listing.latitude!, listing.longitude!]}>
            <Popup maxWidth={280}>
              <div className="map-popup">
                {listing.images?.[0] && (
                  <img src={listing.images[0]} alt="" className="popup-image" />
                )}
                <strong className="popup-price">{listing.price}</strong>
                <div className="popup-title">{listing.title}</div>
                <div className="popup-address">{listing.address}</div>
                <div className="popup-details">
                  {listing.bedrooms != null && <span>{listing.bedrooms} bed</span>}
                  {listing.bathrooms != null && <span>{listing.bathrooms} bath</span>}
                  {listing.size_sq_ft && <span>{listing.size_sq_ft}</span>}
                </div>
                {nearbyCounts[listing.url] && (
                  <div className="popup-nearby">
                    &#127866; {nearbyCounts[listing.url].bars} &nbsp;
                    &#9749; {nearbyCounts[listing.url].cafes} &nbsp;
                    &#128722; {nearbyCounts[listing.url].shops}
                    {nearbyCounts[listing.url].closest_climbing && (
                      <> &nbsp;&#129495; {formatDistance(nearbyCounts[listing.url].closest_climbing!.distance_m)}</>
                    )}
                    <span className="popup-nearby-label">within 1km</span>
                  </div>
                )}
                <div className="popup-links">
                  {listing.floorplan_url && (
                    <a href={listing.floorplan_url} target="_blank" rel="noopener noreferrer" className="popup-link">
                      Floor plan
                    </a>
                  )}
                  {listing.url && (
                    <a href={listing.url} target="_blank" rel="noopener noreferrer" className="popup-link">
                      View listing
                    </a>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
