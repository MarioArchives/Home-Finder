import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceHeatmapProps {
  data: Array<{
    beds: string;
    type: string;
    avg: number;
    count: number;
  }>;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
