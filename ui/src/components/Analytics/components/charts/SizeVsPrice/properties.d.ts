import type { Listing, DrillDownFilter } from '../../../../../types/listing';

export interface SizeVsPriceProps {
  sizeVsPriceBySource: Array<{
    name: string;
    data: Array<{
      sqft: number;
      price: number;
      beds: number;
      address: string;
      source: string;
      pricePerSqft: number;
      listing: Listing;
    }>;
  }>;
  fitLine: Array<{ sqft: number; price: number }>;
  dataCount: number;
  onSelectListing: (listing: Listing) => void;
  onDrillDown?: (filter: DrillDownFilter) => void;
}
