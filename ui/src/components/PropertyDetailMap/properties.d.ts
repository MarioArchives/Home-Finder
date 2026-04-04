import type { Listing, NearbyData } from '../../types/listing'

export interface PropertyDetailMapProps {
  listing: Listing
  nearby?: NearbyData
  onClose: () => void
}
