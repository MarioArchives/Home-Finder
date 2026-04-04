import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceByPostcodeProps {
  data: Array<{
    area: string;
    avg: number;
    median: number;
    min: number;
    max: number;
    count: number;
  }>;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
