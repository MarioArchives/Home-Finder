import type { DrillDownFilter } from '../../../../../types/listing'

export interface EpcRatingsProps {
  data: Array<{ rating: string; count: number }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
