import type { DrillDownFilter } from '../../../../../types/listing'

export interface CouncilTaxChartProps {
  data: Array<{ name: string; value: number }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
