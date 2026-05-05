import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PropertyCard from './PropertyCard'
import { makeListing } from '../../test/fixtures'

// Avoid pulling react-leaflet/canvas into jsdom for the conditional map view.
vi.mock('../PropertyDetailMap/PropertyDetailMap', () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="property-detail-map">
            <button onClick={onClose}>close-map</button>
        </div>
    ),
}))
vi.mock('../FloorplanModal/FloorplanModal', () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="floorplan-modal">
            <button onClick={onClose}>close-floorplan</button>
        </div>
    ),
}))

describe('PropertyCard', () => {
    it('renders price, title and address', () => {
        const listing = makeListing({ url: 'x1', title: 'Cozy flat', address: '5 Mill Lane', price: '£1100 pcm' })
        render(<PropertyCard listing={listing} />)
        expect(screen.getByText('£1100 pcm')).toBeInTheDocument()
        expect(screen.getByText('Cozy flat')).toBeInTheDocument()
        expect(screen.getByText('5 Mill Lane')).toBeInTheDocument()
    })

    it('shows main image when provided, falls back to placeholder when missing', () => {
        const withImg = makeListing({ url: 'a', images: ['https://example.com/a.jpg'] })
        const { rerender } = render(<PropertyCard listing={withImg} />)
        expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/a.jpg')

        const noImg = makeListing({ url: 'b', images: [] })
        rerender(<PropertyCard listing={noImg} />)
        expect(screen.getByRole('img')).toHaveAttribute('src', '/wyn404.png')
    })

    it('falls back to "Price on request" when price empty', () => {
        const listing = makeListing({ url: 'c', price: '' })
        render(<PropertyCard listing={listing} />)
        expect(screen.getByText('Price on request')).toBeInTheDocument()
    })

    it('calls onSelect with listing when card body clicked', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()
        const listing = makeListing({ url: 'd' })
        render(<PropertyCard listing={listing} onSelect={onSelect} />)
        await user.click(screen.getByText(listing.title))
        expect(onSelect).toHaveBeenCalledWith(listing)
    })

    it('renders View listing link when url present', () => {
        const listing = makeListing({ url: 'https://example.com/p/1' })
        render(<PropertyCard listing={listing} />)
        const link = screen.getByRole('link', { name: /view listing/i })
        expect(link).toHaveAttribute('href', 'https://example.com/p/1')
        expect(link).toHaveAttribute('target', '_blank')
    })

    it('shows description when provided', () => {
        const listing = makeListing({ url: 'e', description: 'Bright and airy' })
        render(<PropertyCard listing={listing} />)
        expect(screen.getByText('Bright and airy')).toBeInTheDocument()
    })

    it('renders nearby badges via NearbyBadges child', () => {
        const listing = makeListing({ url: 'f' })
        render(<PropertyCard listing={listing} nearby={{ bars: 3, cafes: 2, shops: 1, places: [] }} />)
        expect(screen.getByText(/3 bars/)).toBeInTheDocument()
    })
})
