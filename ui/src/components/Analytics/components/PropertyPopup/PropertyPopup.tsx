import { MapContainer, TileLayer, Marker, Circle, Popup as LeafletPopup } from 'react-leaflet'
import { amenityDotIcon, propertyDotIcon } from '../../../../shared/mapIcons/mapIcons'
import type { PropertyPopupProps } from './properties'
import './PropertyPopup.css'

export default function PropertyPopup({ listing, nearby, onClose, valueRating }: PropertyPopupProps) {
  if (!listing) return null
  const mainImage = listing.images?.[0]
  const hasCoords = listing.latitude && listing.longitude
  const places = nearby?.places || []

  return (
    <div className="property-popup-overlay" onClick={onClose}>
      <div className="property-popup" onClick={e => e.stopPropagation()}>
        <button className="property-popup-close" onClick={onClose}>&times;</button>
        <img className="property-popup-image" src={mainImage || '/wyn404.png'} alt={listing.title} />
        <div className="property-popup-body">
          <div className="property-popup-price">{listing.price || 'Price on request'}</div>
          <div className="property-popup-title">{listing.title}</div>
          <div className="property-popup-address">{listing.address}</div>
          <div className="property-popup-details">
            {listing.bedrooms != null && <span>{listing.bedrooms} bed</span>}
            {listing.bathrooms != null && <span>{listing.bathrooms} bath</span>}
            {listing.size_sq_ft && <span>{listing.size_sq_ft}</span>}
          </div>
          <div className="property-popup-tags">
            {listing.property_type && <span className="tag">{listing.property_type}</span>}
            {listing.furnish_type && <span className="tag green">{listing.furnish_type}</span>}
            {listing.epc_rating && <span className="tag green">EPC {listing.epc_rating}</span>}
            {listing.council_tax && <span className="tag">{listing.council_tax}</span>}
            {listing.available_from && <span className="tag">Available: {listing.available_from}</span>}
            {listing.deposit && <span className="tag">Deposit: {listing.deposit}</span>}
            {valueRating && <span className={`tag value-rating ${valueRating.includes('good') ? 'value-good' : 'value-bad'} ${valueRating.startsWith('very') ? 'value-strong' : ''}`}>{valueRating}</span>}
          </div>
          {nearby && (
            <div className="property-popup-nearby-badges">
              <span title="Bars & pubs within 1km">&#127866; {nearby.bars} bar{nearby.bars !== 1 ? 's' : ''}</span>
              <span title="Cafes within 1km">&#9749; {nearby.cafes} cafe{nearby.cafes !== 1 ? 's' : ''}</span>
              <span title="Shops within 1km">&#128722; {nearby.shops} shop{nearby.shops !== 1 ? 's' : ''}</span>
            </div>
          )}
          {listing.description && (
            <div className="property-popup-desc">{listing.description}</div>
          )}
          {listing.floorplan_url && (
            <div className="property-popup-floorplan">
              <h4>Floor Plan</h4>
              <img src={listing.floorplan_url} alt="Floor plan" />
            </div>
          )}
          {hasCoords && (
            <div className="property-popup-map-section">
              <h4>Nearby Amenities</h4>
              <div className="property-popup-map-legend">
                <span><span className="legend-dot legend-dot--property" /> Property</span>
                <span><span className="legend-dot legend-dot--bars" /> Bars/Pubs</span>
                <span><span className="legend-dot legend-dot--cafes" /> Cafes</span>
                <span><span className="legend-dot legend-dot--shops" /> Shops</span>
              </div>
              <MapContainer center={[listing.latitude!, listing.longitude!]} zoom={15} className="property-popup-map">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Circle center={[listing.latitude!, listing.longitude!]} radius={1000} pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.05, weight: 1, dashArray: '6 4' }} />
                <Marker position={[listing.latitude!, listing.longitude!]} icon={propertyDotIcon}>
                  <LeafletPopup>{listing.price} &mdash; {listing.address}</LeafletPopup>
                </Marker>
                {places.map((place, i) => (
                  <Marker key={i} position={[place.lat, place.lon]} icon={amenityDotIcon(place.category)}>
                    <LeafletPopup>
                      <strong>{place.name || place.category}</strong>
                      <br />{place.category === 'bars' ? 'Bar/Pub' : place.category === 'cafes' ? 'Cafe' : 'Shop'}
                      <br />{place.distance_m}m away
                    </LeafletPopup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
          <div className="property-popup-footer">
            <span>{listing.agent}</span>
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noopener noreferrer">View listing</a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
