export interface Listing {
  source: string
  listing_type: string
  title: string
  address: string
  price: string
  bedrooms: number | null
  bathrooms: number | null
  property_type: string
  agent: string
  url: string
  added_on: string
  description: string
  images: string[]
  council_tax: string | null
  size_sq_ft: string | null
  epc_rating: string | null
  latitude: number | null
  longitude: number | null
  key_features: string[]
  furnish_type: string | null
  let_type: string | null
  available_from: string | null
  min_tenancy: string | null
  deposit: string | null
  floorplan_url: string | null
}

export interface NearbyPlace {
  lat: number
  lon: number
  category: string
  name: string
  distance_m: number
}

export interface ClosestAmenity {
  name: string
  distance_m: number
  lat: number
  lon: number
  category: string
}

export interface NearbyData {
  bars: number
  cafes: number
  shops: number
  closest_climbing?: ClosestAmenity
  closest_amenities?: Record<string, ClosestAmenity>
  commute_distance_m?: number
  commute_duration_s?: number
  places: NearbyPlace[]
}

export interface ListingsData {
  city: string
  listing_type: string
  sources: string
  scraped_at: string
  total_listings: number
  listings: Listing[]
}

export interface FilterState {
  search: string
  minPrice: string
  maxPrice: string
  bedrooms: string
  maxBedrooms: string
  bathrooms: string
  propertyType: string
  propertyTypes: string[]
  source: string
  furnishType: string
  councilTax: string
  minSqFt: string
  maxSqFt: string
  availableFrom: string
  availableTo: string
  excludeShares: boolean
  pinLat: string
  pinLng: string
  pinRadius: string
}

export type DrillDownFilter = Partial<FilterState>

export interface Alert {
  id: string
  name: string
  minPrice: number | null
  maxPrice: number | null
  minBedrooms: number | null
  maxBedrooms: number | null
  minBathrooms: number | null
  source: string | null
  councilTaxBands: string[] | null
  propertyTypes: string[] | null
  furnishTypes: string[] | null
  minSqFt: number | null
  maxSqFt: number | null
  availableFrom: string | null
  availableTo: string | null
  pinLat: number | null
  pinLng: number | null
  pinRadius: number | null
  excludeShares: boolean
  search: string
  chatIds: string[] | null
  createdAt: string
}

export interface Chat {
  chat_id: string
  name: string
  alert_ids: string[] | null
}

export interface CustomPin {
  id: string
  label: string
  emoji: string
  lat: number
  lng: number
}

