import type { Listing, NearbyData } from '../../types/listing'

export interface MapViewProps {
  listings: Listing[]
  nearbyCounts: Record<string, NearbyData>
}
