import type { FilterState } from '../types/listing'

export const INITIAL_FILTERS: FilterState = {
    search: '', minPrice: '', maxPrice: '', bedrooms: '', maxBedrooms: '',
    bathrooms: '', propertyType: '', propertyTypes: [], source: '',
    furnishType: '', furnishTypes: [], councilTax: '', minSqFt: '', maxSqFt: '',
    availableFrom: '', availableTo: '', excludeShares: false,
    pinLat: '', pinLng: '', pinRadius: '',
}

export const DEFAULT_SORT = 'price-asc'
