import type { DrillDownFilter } from '../../../../../types/listing'

export interface AvailabilityTimelineProps {
  data: Array<{
    month: string;
    count: number;
  }>;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
