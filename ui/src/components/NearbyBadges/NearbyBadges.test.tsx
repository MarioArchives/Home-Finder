import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NearbyBadges from './NearbyBadges'

describe('NearbyBadges', () => {
    it('renders loading when nearby is undefined', () => {
        render(<NearbyBadges />)
        expect(screen.getByText(/loading nearby places/i)).toBeInTheDocument()
    })

    it('renders core counts (bars/cafes/shops)', () => {
        render(<NearbyBadges nearby={{ bars: 3, cafes: 5, shops: 2, places: [] }} />)
        expect(screen.getByText(/3 bars/i)).toBeInTheDocument()
        expect(screen.getByText(/5 cafes/i)).toBeInTheDocument()
        expect(screen.getByText(/2 shops/i)).toBeInTheDocument()
    })

    it('singular form when count is 1', () => {
        render(<NearbyBadges nearby={{ bars: 1, cafes: 1, shops: 1, places: [] }} />)
        expect(screen.getByText(/1 bar(?!s)/)).toBeInTheDocument()
        expect(screen.getByText(/1 cafe(?!s)/)).toBeInTheDocument()
        expect(screen.getByText(/1 shop(?!s)/)).toBeInTheDocument()
    })

    it('shows climbing badge from closest_climbing fallback', () => {
        render(<NearbyBadges nearby={{
            bars: 0, cafes: 0, shops: 0, places: [],
            closest_climbing: { name: 'Crag', distance_m: 750, lat: 0, lon: 0, category: 'climbing' },
        }} />)
        expect(screen.getByTitle(/Nearest climbing gym: Crag/)).toBeInTheDocument()
    })

    it('shows cinema badge from closest_amenities map', () => {
        render(<NearbyBadges nearby={{
            bars: 0, cafes: 0, shops: 0, places: [],
            closest_amenities: { cinema: { name: 'Odeon', distance_m: 1500, lat: 0, lon: 0, category: 'cinema' } },
        }} />)
        expect(screen.getByTitle(/Nearest cinema: Odeon/)).toBeInTheDocument()
    })

    it('renders commute distance and duration when both provided', () => {
        render(<NearbyBadges
            nearby={{ bars: 0, cafes: 0, shops: 0, places: [] }}
            commuteDistance={5400}
            commuteDuration={900}
        />)
        const badge = screen.getByTitle(/Commute to work/)
        expect(badge).toBeInTheDocument()
        expect(badge.textContent).toMatch(/5\.4km/)
        expect(badge.textContent).toMatch(/15min/)
    })

    it('renders custom pin badges by label', () => {
        render(<NearbyBadges
            nearby={{ bars: 0, cafes: 0, shops: 0, places: [] }}
            pinDistances={[
                { label: 'Office', emoji: '🏢', distance_m: 2000 },
                { label: 'Gym', emoji: '🏋️', distance_m: 500 },
            ]}
        />)
        expect(screen.getByTitle('Distance to Office')).toBeInTheDocument()
        expect(screen.getByTitle('Distance to Gym')).toBeInTheDocument()
    })
})
