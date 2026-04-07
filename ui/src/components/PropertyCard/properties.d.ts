import type { Listing, NearbyData } from '../../types/listing'
import type { PinDistance } from '../NearbyBadges/properties'

export interface PropertyCardProps {
  listing: Listing
  nearby?: NearbyData
  onSelect?: (listing: Listing) => void
  valueRating?: string
  city?: string
  commuteDistance?: number | null
  commuteDuration?: number | null
  pinDistances?: PinDistance[]
}
