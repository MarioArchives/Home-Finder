import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import CronFooter from './CronFooter'
import { server } from '../../test/handlers'

describe('CronFooter', () => {
    it('renders nothing while status hasnt arrived', () => {
        // Make the endpoint hang — initial state should stay null and render no DOM.
        server.use(http.get('/api/cron/status', () => new Promise(() => {})))
        const { container } = render(<CronFooter />)
        expect(container.firstChild).toBeNull()
    })

    it('renders idle state with last_scrape', async () => {
        const recentIso = new Date(Date.now() - 30 * 60_000).toISOString()
        server.use(http.get('/api/cron/status', () => HttpResponse.json({
            running: false, job: null, percent: null, last_scrape: recentIso,
        })))
        render(<CronFooter />)
        await waitFor(() => expect(screen.getByText(/Up to date/)).toBeInTheDocument())
        expect(screen.getByText(/last scrape/)).toBeInTheDocument()
    })

    it('renders running state with progress bar', async () => {
        server.use(http.get('/api/cron/status', () => HttpResponse.json({
            running: true, job: 'scrape', percent: 42, last_scrape: null,
            sources: { rightmove: { pages_done: 1, total_pages: 5, detail_current: 0, detail_total: 0, percent: 20 } },
        })))
        render(<CronFooter />)
        await waitFor(() => expect(screen.getByText(/Scraping listings/)).toBeInTheDocument())
        expect(screen.getByText('42%')).toBeInTheDocument()
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    })

    it('renders error state with summary text', async () => {
        server.use(http.get('/api/cron/status', () => HttpResponse.json({
            running: false, job: null, percent: null, last_scrape: null,
            stages: {
                scrape: { last_ok: null, last_attempt: null, last_error: 'boom', attempts_today: 1, state: 'failing' },
                amenities: { last_ok: null, last_attempt: null, last_error: null, attempts_today: 0, state: 'pending' },
                alerts: { last_ok: null, last_attempt: null, last_error: null, attempts_today: 0, state: 'pending' },
            },
            status_summary: 'scrape failing',
        })))
        render(<CronFooter />)
        await waitFor(() => expect(screen.getByText(/Pipeline issue/)).toBeInTheDocument())
        expect(screen.getByText(/scrape failing/)).toBeInTheDocument()
    })

    it('opens modal when idle footer clicked', async () => {
        const user = userEvent.setup()
        server.use(http.get('/api/cron/status', () => HttpResponse.json({
            running: false, job: null, percent: null, last_scrape: null,
        })))
        render(<CronFooter />)
        await waitFor(() => expect(screen.getByText(/Up to date/)).toBeInTheDocument())
        await user.click(screen.getByRole('button', { name: /show pipeline status/i }))
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })
})
