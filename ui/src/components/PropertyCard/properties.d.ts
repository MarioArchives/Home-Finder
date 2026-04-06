import type { Listing, NearbyData } from '../../types/listing'

export interface PropertyCardProps {
  listing: Listing
  nearby?: NearbyData
  onSelect?: (listing: Listing) => void
  valueRating?: string
  city?: string
  commuteDistance?: number | null
  commuteDuration?: number | null
}
