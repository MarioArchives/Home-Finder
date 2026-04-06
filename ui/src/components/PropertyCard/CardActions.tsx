import type { Listing, NearbyData } from '../../types/listing'

interface CardActionsProps {
  listing: Listing
  nearby?: NearbyData
  onShowMap: () => void
  onShowFloorplan: () => void
}

export default function CardActions({ listing, nearby, onShowMap, onShowFloorplan }: CardActionsProps) {
  const hasPlaces = (nearby?.places?.length ?? 0) > 0
  const hasActions = (hasPlaces && listing.latitude) || listing.floorplan_url
  if (!hasActions) return null

  return (
    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
      {hasPlaces && listing.latitude && (
        <button className="btn-detail-map" onClick={onShowMap}>
          View nearby places on map
        </button>
      )}
      {listing.floorplan_url && (
        <button className="btn-detail-map" onClick={onShowFloorplan}>
          View floor plan
        </button>
      )}
    </div>
  )
}
