import type { Listing, DrillDownFilter } from '../../../../../types/listing';

export interface PriceScatterProps {
  scatterBySource: Array<{
    name: string;
    data: Array<{
      beds: number;
      price: number;
      baths: number;
      address: string;
      source: string;
      listing: Listing;
    }>;
  }>;
  onSelectListing: (listing: Listing) => void;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
