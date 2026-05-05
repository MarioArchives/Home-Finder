import type { Listing, ListingsData, NearbyData } from '../types/listing'

export function makeListing(overrides: Partial<Listing> = {}): Listing {
    return {
        source: 'rightmove',
        listing_type: 'rent',
        title: 'Sample property',
        address: '1 Sample St, Manchester',
        price: '£1200 pcm',
        bedrooms: 2,
        bathrooms: 1,
        property_type: 'Flat',
        agent: 'Test Agency',
        url: 'https://example.com/p/1',
        added_on: '01/01/2026',
        description: 'A sample listing.',
        images: ['https://example.com/img1.jpg'],
        council_tax: 'Band B',
        size_sq_ft: '700',
        epc_rating: 'C',
        latitude: 53.4808,
        longitude: -2.2426,
        key_features: [],
        furnish_type: 'Furnished',
        let_type: 'Long term',
        available_from: '01/02/2026',
        min_tenancy: '12 months',
        deposit: '£1200',
        floorplan_url: null,
        ...overrides,
    }
}

export const sampleListings: Listing[] = [
    makeListing({ url: 'l1', price: '£900 pcm', bedrooms: 1, bathrooms: 1, size_sq_ft: '500', property_type: 'Flat', source: 'rightmove', furnish_type: 'Furnished', latitude: 53.48, longitude: -2.24 }),
    makeListing({ url: 'l2', price: '£1200 pcm', bedrooms: 2, bathrooms: 1, size_sq_ft: '700', property_type: 'Flat', source: 'zoopla', furnish_type: 'Unfurnished', latitude: 53.49, longitude: -2.25 }),
    makeListing({ url: 'l3', price: '£1500 pcm', bedrooms: 3, bathrooms: 2, size_sq_ft: '900', property_type: 'House', source: 'rightmove', furnish_type: 'Furnished', latitude: 53.50, longitude: -2.26, council_tax: 'Band C' }),
    makeListing({ url: 'l4', price: '£2200 pcm', bedrooms: 4, bathrooms: 2, size_sq_ft: '1200', property_type: 'House', source: 'zoopla', furnish_type: 'Unfurnished', latitude: 53.51, longitude: -2.27, council_tax: 'Band D' }),
    makeListing({ url: 'l5', price: '£600 pcm', bedrooms: 1, bathrooms: 1, size_sq_ft: '300', property_type: 'Flat', source: 'rightmove', title: 'Double room available in shared house', description: 'Room to rent in friendly flat share', furnish_type: 'Furnished', latitude: 53.47, longitude: -2.23 }),
]

export const sampleListingsData: ListingsData = {
    city: 'Manchester',
    listing_type: 'rent',
    sources: 'rightmove,zoopla',
    scraped_at: '2026-04-01T12:00:00Z',
    total_listings: sampleListings.length,
    listings: sampleListings,
}

export const sampleAmenities: Record<string, NearbyData> = {
    l1: { bars: 5, cafes: 4, shops: 3, places: [], closest_amenities: { climbing: { name: 'Crag', distance_m: 800, lat: 53.48, lon: -2.24, category: 'climbing' } } },
    l2: { bars: 8, cafes: 6, shops: 4, places: [], closest_amenities: { cinema: { name: 'Cine', distance_m: 1200, lat: 53.49, lon: -2.25, category: 'cinema' } } },
    l3: { bars: 2, cafes: 1, shops: 1, places: [] },
    l4: { bars: 1, cafes: 0, shops: 0, places: [] },
    l5: { bars: 10, cafes: 8, shops: 6, places: [] },
}

export const sampleSources = {
    sources: [
        { name: 'rightmove', display_name: 'Rightmove', icon: 'R', color: '#00deb6', bg: 'rgba(0,222,182,0.12)', supports_buy: true },
        { name: 'zoopla', display_name: 'Zoopla', icon: 'Z', color: '#7a2cff', bg: 'rgba(122,44,255,0.12)', supports_buy: true },
        { name: 'openrent', display_name: 'OpenRent', icon: 'O', color: '#ff7a00', bg: 'rgba(255,122,0,0.12)', supports_buy: false },
    ],
}

export const readyStatus = {
    status: 'ready',
    telegram_configured: true,
    config: { city: 'Manchester', listing_type: 'rent', sources: 'rightmove,zoopla' },
}

export const setupNeededStatus = {
    status: 'setup_needed',
    telegram_configured: false,
}

export const scrapingStatus = {
    status: 'scraping',
    telegram_configured: false,
}
