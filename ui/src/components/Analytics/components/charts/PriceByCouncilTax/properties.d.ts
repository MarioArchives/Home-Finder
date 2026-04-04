import type { DrillDownFilter } from '../../../../../types/listing'

export interface PriceByCouncilTaxProps {
  data: Array<{
    band: string;
    avg: number;
    count: number;
  }>;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
