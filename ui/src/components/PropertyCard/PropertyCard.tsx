import { useState, memo } from 'react'
import NearbyBadges from '../NearbyBadges/NearbyBadges'
import PropertyDetailMap from '../PropertyDetailMap/PropertyDetailMap'
import FloorplanModal from '../FloorplanModal/FloorplanModal'
import CardDetails from './CardDetails'
import CardTags from './CardTags'
import CardActions from './CardActions'
import type { PropertyCardProps } from './properties'
import './PropertyCard.css'

function PropertyCard({ listing, nearby, onSelect, valueRating, city, commuteDistance, commuteDuration, pinDistances }: PropertyCardProps) {
  const [showMap, setShowMap] = useState(false)
  const [showFloorplan, setShowFloorplan] = useState(false)
  const mainImage = listing.images?.[0]

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
          <CardDetails listing={listing} />
          <CardTags listing={listing} valueRating={valueRating} />
          <NearbyBadges nearby={nearby} commuteDistance={commuteDistance} commuteDuration={commuteDuration} pinDistances={pinDistances} />
          <CardActions
            listing={listing}
            nearby={nearby}
            onShowMap={() => setShowMap(true)}
            onShowFloorplan={() => setShowFloorplan(true)}
          />
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
