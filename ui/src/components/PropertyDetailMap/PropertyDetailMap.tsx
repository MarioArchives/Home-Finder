import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet'
import { amenityIcon, propertyIcon } from '../../shared/mapIcons/mapIcons'
import { formatDistance } from '../../shared/utils/utils'
import type { PropertyDetailMapProps } from './properties'
import './PropertyDetailMap.css'

export default function PropertyDetailMap({ listing, nearby, city, onClose }: PropertyDetailMapProps) {
  const places = nearby?.places || []
  const center: [number, number] = [listing.latitude!, listing.longitude!]

  return (
    <div className="detail-map-overlay" onClick={onClose}>
      <div className="detail-map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail-map-header">
          <div>
            <strong>{listing.price}</strong> &mdash; {listing.title}
            <div className="detail-map-address">{listing.address}</div>
          </div>
          <button className="detail-map-close" onClick={onClose}>&times;</button>
        </div>
        <div className="detail-map-legend">
          <span>&#127968; Property</span>
          <span>&#127866; Bars/Pubs ({nearby?.bars ?? 0})</span>
          <span>&#9749; Cafes ({nearby?.cafes ?? 0})</span>
          <span>&#128722; Shops ({nearby?.shops ?? 0})</span>
          {nearby?.closest_climbing && (
            <span>&#129495; Climbing ({formatDistance(nearby.closest_climbing.distance_m)})</span>
          )}
        </div>
        <MapContainer center={center} zoom={15} className="detail-leaflet-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <Circle center={center} radius={1000} pathOptions={{ color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.08, weight: 1.5, dashArray: '6 4' }} />
          <Marker position={center} icon={propertyIcon}>
            <Popup>{listing.price} &mdash; {listing.address}</Popup>
          </Marker>
          {places.map((place, i) => (
            <Marker
              key={i}
              position={[place.lat, place.lon]}
              icon={amenityIcon(place.category)}
              eventHandlers={{
                click: () => {
                  const query = place.name || place.category
                  window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(query + (city ? ' ' + city : ''))}`,
                    '_blank'
                  )
                },
                mouseover: (e) => {
                  (e.target as L.Marker).bindTooltip(
                    `<strong>${place.name || place.category}</strong><br/>${place.distance_m}m away`,
                    { direction: 'top', offset: [0, -10], className: 'amenity-tooltip' }
                  ).openTooltip()
                },
                mouseout: (e) => {
                  (e.target as L.Marker).closeTooltip()
                },
              }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
