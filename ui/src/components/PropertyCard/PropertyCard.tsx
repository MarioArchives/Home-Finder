import { useState, memo } from 'react'
import NearbyBadges from '../NearbyBadges/NearbyBadges'
import PropertyDetailMap from '../PropertyDetailMap/PropertyDetailMap'
import FloorplanModal from '../FloorplanModal/FloorplanModal'
import type { PropertyCardProps } from './properties'
import './PropertyCard.css'

function PropertyCard({ listing, nearby, onSelect, valueRating, city }: PropertyCardProps) {
  const [showMap, setShowMap] = useState(false)
  const [showFloorplan, setShowFloorplan] = useState(false)
  const mainImage = listing.images?.[0]
  const hasPlaces = (nearby?.places?.length ?? 0) > 0

  return (
    <>
      <div className="property-card" onClick={() => onSelect?.(listing)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
        {mainImage ? (
          <img className="card-image" src={mainImage} alt={listing.title} loading="lazy" />
        ) : (
          <img className="card-image" src="/wyn404.png" alt="No image available" loading="lazy" />
        )}
        <div className="card-body">
          <div className="card-price">{listing.price || 'Price on request'}</div>
          <div className="card-title">{listing.title}</div>
          <div className="card-address">{listing.address}</div>
          <div className="card-details">
            {listing.bedrooms != null && (
              <span className="card-detail">{listing.bedrooms} bed</span>
            )}
            {listing.bathrooms != null && (
              <span className="card-detail">{listing.bathrooms} bath</span>
            )}
            {listing.size_sq_ft && (
              <span className="card-detail">{listing.size_sq_ft}</span>
            )}
          </div>
          <div className="card-tags">
            <span className="tag">{listing.source}</span>
            {listing.property_type && <span className="tag">{listing.property_type}</span>}
            {listing.furnish_type && <span className="tag green">{listing.furnish_type}</span>}
            {listing.epc_rating && <span className="tag green">EPC {listing.epc_rating}</span>}
            {listing.council_tax && <span className="tag">{listing.council_tax}</span>}
            {valueRating && <span className={`tag value-rating ${valueRating.includes('good') ? 'value-good' : 'value-bad'} ${valueRating.startsWith('very') ? 'value-strong' : ''}`}>{valueRating}</span>}
          </div>
          <NearbyBadges nearby={nearby} />
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            {hasPlaces && listing.latitude && (
              <button className="btn-detail-map" onClick={() => setShowMap(true)}>
                View nearby places on map
              </button>
            )}
            {listing.floorplan_url && (
              <button className="btn-detail-map" onClick={() => setShowFloorplan(true)}>
                View floor plan
              </button>
            )}
          </div>
          {listing.description && (
            <div className="card-description">{listing.description}</div>
          )}
        </div>
        <div className="card-footer" onClick={(e) => e.stopPropagation()}>
          <span>{listing.added_on || listing.agent}</span>
          <div className="card-footer-links">
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noopener noreferrer">
                View listing
              </a>
            )}
          </div>
        </div>
      </div>
      {showMap && (
        <PropertyDetailMap listing={listing} nearby={nearby} city={city} onClose={() => setShowMap(false)} />
      )}
      {showFloorplan && listing.floorplan_url && (
        <FloorplanModal
          floorplanUrl={listing.floorplan_url}
          address={listing.address}
          onClose={() => setShowFloorplan(false)}
        />
      )}
    </>
  )
}

export default memo(PropertyCard)
