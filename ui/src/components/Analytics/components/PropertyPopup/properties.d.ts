import type { Listing, NearbyData } from '../../../../types/listing'

export interface PropertyPopupProps {
  listing: Listing | null
  nearby?: NearbyData | null
  onClose: () => void
  valueRating?: string
}
