import type { DrillDownFilter } from '../../../../../types/listing'

export interface PropertyTypesProps {
  data: Array<{ name: string; count: number }>
  onDrillDown?: (filter: DrillDownFilter) => void
}
