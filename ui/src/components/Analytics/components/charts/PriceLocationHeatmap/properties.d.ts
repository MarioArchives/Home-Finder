import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceLocationHeatmapProps {
  data: Array<{ lat: number; lng: number; price: number; address: string }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
