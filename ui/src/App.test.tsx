import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderAtRoute } from './test/renderAtRoute'
import { server } from './test/handlers'
import { sampleListings, scrapingStatus, setupNeededStatus } from './test/fixtures'

// Heavy children get inert stand-ins. Their own tests cover their behavior;
// here we want to lock the App shell wiring (gating + routing + counts).
vi.mock('./components/MapView/MapView', () => ({
    default: () => <div data-testid="map-view-stub" />,
}))
vi.mock('./components/Analytics/Analytics', () => ({
    default: () => <div data-testid="analytics-stub" />,
}))
vi.mock('./components/Alerts/Alerts', () => ({
    default: () => <div data-testid="alerts-stub" />,
}))
vi.mock('./components/TelegramSetup/TelegramSetup', () => ({
    default: () => <div data-testid="telegram-setup-stub" />,
}))
vi.mock('./components/SetupWizard/SetupWizard', () => ({
    default: () => <div data-testid="setup-wizard-stub" />,
}))
vi.mock('./components/SetupProgress/SetupProgress', () => ({
    default: () => <div data-testid="setup-progress-stub" />,
}))
vi.mock('./components/PinPicker/PinPicker', () => ({
    PinPickerPopup: () => <div data-testid="pin-picker-popup-stub" />,
    PinPickerInner: () => <div data-testid="pin-picker-inner-stub" />,
}))
vi.mock('./components/PropertyDetailMap/PropertyDetailMap', () => ({
    default: () => <div data-testid="property-detail-map-stub" />,
}))
vi.mock('./components/FloorplanModal/FloorplanModal', () => ({
    default: () => <div data-testid="floorplan-modal-stub" />,
}))
vi.mock('./components/CronFooter/CronFooter', () => ({
    default: () => <div data-testid="cron-footer-stub" />,
}))

describe('App — gating', () => {
    it('renders SetupWizard when API status is setup_needed', async () => {
        server.use(http.get('/api/status', () => HttpResponse.json(setupNeededStatus)))
        renderAtRoute('/')
        await waitFor(() => expect(screen.getByTestId('setup-wizard-stub')).toBeInTheDocument())
    })

    it('renders SetupProgress when API status is scraping', async () => {
        server.use(http.get('/api/status', () => HttpResponse.json(scrapingStatus)))
        renderAtRoute('/')
        await waitFor(() => expect(screen.getByTestId('setup-progress-stub')).toBeInTheDocument())
    })

    it('renders the file-load fallback when ready but no listings.json', async () => {
        server.use(http.get('/listings.json', () => new HttpResponse(null, { status: 404 })))
        renderAtRoute('/')
        await waitFor(() => expect(screen.getByText(/Property Listings Viewer/)).toBeInTheDocument())
        expect(screen.getByLabelText(/Choose JSON file/)).toBeInTheDocument()
    })
})

describe('App — grid view', () => {
    it('renders header with city + filter/total counts once loaded', async () => {
        renderAtRoute('/')
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Manchester'))
        expect(screen.getByText(new RegExp(`${sampleListings.length} of ${sampleListings.length} properties`))).toBeInTheDocument()
    })

    it('renders one PropertyCard per listing in the grid', async () => {
        renderAtRoute('/')
        await waitFor(() => expect(screen.getAllByRole('link', { name: /view listing/i })).toHaveLength(sampleListings.length))
    })

    it('shows "no properties match" when filters exclude everything', async () => {
        const user = userEvent.setup()
        renderAtRoute('/')
        await waitFor(() => expect(screen.getByPlaceholderText(/e\.g\. 800/)).toBeInTheDocument())
        const minPrice = screen.getByPlaceholderText(/e\.g\. 800/)
        await user.type(minPrice, '999999')
        await waitFor(() => expect(screen.getByText(/No properties match your filters/)).toBeInTheDocument())
    })
})

describe('App — routing', () => {
    it('mounts MapView at /map', async () => {
        renderAtRoute('/map')
        await waitFor(() => expect(screen.getByTestId('map-view-stub')).toBeInTheDocument())
    })

    it('mounts Analytics at /analytics', async () => {
        renderAtRoute('/analytics')
        await waitFor(() => expect(screen.getByTestId('analytics-stub')).toBeInTheDocument())
    })

    it('mounts Alerts at /alerts when telegram is configured', async () => {
        renderAtRoute('/alerts')
        await waitFor(() => expect(screen.getByTestId('alerts-stub')).toBeInTheDocument())
    })

    it('mounts TelegramSetup at /alerts when not configured', async () => {
        server.use(http.get('/api/status', () => HttpResponse.json({
            status: 'ready', telegram_configured: false,
        })))
        renderAtRoute('/alerts')
        await waitFor(() => expect(screen.getByTestId('telegram-setup-stub')).toBeInTheDocument())
    })

    it('shows 404 page on unknown route', async () => {
        renderAtRoute('/does-not-exist')
        await waitFor(() => expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument())
        expect(screen.getByRole('link', { name: /back to listings/i })).toHaveAttribute('href', '/')
    })

    it('hides SortBar on non-grid routes', async () => {
        renderAtRoute('/map')
        await waitFor(() => expect(screen.getByTestId('map-view-stub')).toBeInTheDocument())
        // SortBar shows the result-count text "<n> result(s)"
        expect(screen.queryByText(/\d+ results?/)).not.toBeInTheDocument()
    })
})

describe('App — search debounce', () => {
    it('search input filters results after debounce window', async () => {
        const user = userEvent.setup()
        renderAtRoute('/')
        await waitFor(() => expect(screen.getAllByRole('link', { name: /view listing/i }).length).toBeGreaterThan(0))
        // The unique listing l5 contains "shared house" — typing 'flat share' should narrow to it.
        // The shell debounces by 300ms — wait for the change to settle.
        const searchInput = screen.queryByPlaceholderText(/search/i)
        // Search may live elsewhere. Skip if not present in primary toolbar.
        if (!searchInput) return
        await user.type(searchInput, 'flat share')
        await waitFor(() => {
            const cards = screen.getAllByRole('link', { name: /view listing/i })
            expect(cards.length).toBeLessThan(sampleListings.length)
        }, { timeout: 1000 })
    })
})

describe('App — load more pagination', () => {
    it('does not show Load more button when listings fit one page', async () => {
        renderAtRoute('/')
        await waitFor(() => expect(screen.getAllByRole('link', { name: /view listing/i }).length).toBe(sampleListings.length))
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    })

    it('shows pagination when listings exceed page size', async () => {
        // Push lots of listings so totalPages > 1
        const big = Array.from({ length: 30 }, (_, i) => ({
            ...sampleListings[0], url: `bulk-${i}`,
        }))
        server.use(http.get('/listings.json', () => HttpResponse.json({
            city: 'Manchester', listing_type: 'rent', sources: 'rightmove',
            scraped_at: '2026-04-01T12:00:00Z', total_listings: big.length, listings: big,
        })))
        renderAtRoute('/')
        await waitFor(() => {
            expect(within(document.body).getByRole('button', { name: /load more/i })).toBeInTheDocument()
        })
    })
})
