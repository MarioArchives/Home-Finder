import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceDistributionProps {
  data: Array<{ range: string; price: number; count: number }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
