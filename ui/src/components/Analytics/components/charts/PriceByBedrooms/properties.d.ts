import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceByBedroomsProps {
  data: Array<{
    beds: string
    bedsNum: number
    avg: number
    median: number
    min: number
    max: number
    q1: number
    q3: number
    count: number
  }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
