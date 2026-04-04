import type { Listing, NearbyData, DrillDownFilter } from '../../types/listing'

export interface AnalyticsProps {
  listings: Listing[]
  nearbyCounts?: Record<string, NearbyData>
  onDrillDown?: (filter: DrillDownFilter) => void
  onSelectListing?: (listing: Listing) => void
}
