import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppHeader from './AppHeader'
import { renderWithRouter } from '../../test/renderApp'

const baseProps = {
    city: 'Manchester',
    listingType: 'rent',
    filteredCount: 12,
    totalCount: 30,
    scrapedAt: '2026-04-01T12:00:00Z',
    nearbyStatus: 'idle' as const,
    onLoadAmenitiesFile: vi.fn(),
    onReset: vi.fn(),
}

describe('AppHeader', () => {
    it('renders the title with city + Rentals label for rent', () => {
        renderWithRouter(<AppHeader {...baseProps} />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Manchester')
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Rentals/)
    })

    it('renders For Sale label when listingType is not rent', () => {
        renderWithRouter(<AppHeader {...baseProps} listingType="buy" />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/For Sale/)
    })

    it('shows filtered/total counts', () => {
        renderWithRouter(<AppHeader {...baseProps} />)
        expect(screen.getByText(/12 of 30 properties/)).toBeInTheDocument()
    })

    it('renders nav links to all 4 routes', () => {
        renderWithRouter(<AppHeader {...baseProps} />)
        expect(screen.getByRole('link', { name: 'Grid' })).toHaveAttribute('href', '/')
        expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map')
        expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/analytics')
        expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts')
    })

    it('shows loading note when nearbyStatus is loading', () => {
        renderWithRouter(<AppHeader {...baseProps} nearbyStatus="loading" />)
        expect(screen.getByText(/Loading nearby places/i)).toBeInTheDocument()
    })

    it('shows amenity-file-load link when nearbyStatus is error', () => {
        renderWithRouter(<AppHeader {...baseProps} nearbyStatus="error" />)
        expect(screen.getByText(/Load amenities file/i)).toBeInTheDocument()
    })

    it('calls onReset when load-different-file is clicked', async () => {
        const user = userEvent.setup()
        renderWithRouter(<AppHeader {...baseProps} />)
        await user.click(screen.getByText(/Load different file/i))
        expect(baseProps.onReset).toHaveBeenCalled()
    })
})
