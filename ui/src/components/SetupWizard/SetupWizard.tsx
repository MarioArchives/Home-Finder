import { useState } from 'react'
import './SetupWizard.css'

interface SetupWizardProps {
    onStarted: () => void
}

export default function SetupWizard({ onStarted }: SetupWizardProps) {
    const [city, setCity] = useState('')
    const [type, setType] = useState<'rent' | 'buy'>('rent')
    const [source, setSource] = useState<'rightmove' | 'zoopla' | 'both'>('rightmove')
    const [pages, setPages] = useState(5)
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!city.trim()) {
            setError('Please enter a city')
            return
        }
        setSubmitting(true)
        setError('')

        try {
            const res = await fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city: city.trim(), type, source, pages }),
            })
            if (!res.ok) {
                const data = await res.json()
                setError(data.error || 'Failed to start setup')
                setSubmitting(false)
                return
            }
            onStarted()
        } catch {
            setError('Failed to connect to server')
            setSubmitting(false)
        }
    }

    return (
        <div className="setup-wizard">
            <div className="setup-card">
                <h1>Property Listings</h1>
                <p className="setup-subtitle">Set up your property search to get started.</p>

                <form onSubmit={handleSubmit}>
                    <div className="setup-field">
                        <label htmlFor="city">City or area</label>
                        <input
                            id="city"
                            type="text"
                            placeholder="e.g. Manchester"
                            value={city}
                            onChange={e => setCity(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="setup-field">
                        <label>Listing type</label>
                        <div className="setup-toggle">
                            <button
                                type="button"
                                className={type === 'rent' ? 'active' : ''}
                                onClick={() => setType('rent')}
                            >
                                Rent
                            </button>
                            <button
                                type="button"
                                className={type === 'buy' ? 'active' : ''}
                                onClick={() => setType('buy')}
                            >
                                Buy
                            </button>
                        </div>
                    </div>

                    <div className="setup-field">
                        <label>Source</label>
                        <div className="setup-toggle three">
                            {(['rightmove', 'zoopla', 'both'] as const).map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    className={source === s ? 'active' : ''}
                                    onClick={() => setSource(s)}
                                >
                                    {s === 'both' ? 'Both' : s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="setup-field">
                        <label htmlFor="pages">Pages to scrape per source</label>
                        <input
                            id="pages"
                            type="number"
                            min={1}
                            max={100}
                            value={pages}
                            onChange={e => {
                                const val = e.target.value
                                if (val === '') { setPages('' as unknown as number); return }
                                const n = parseInt(val)
                                if (!isNaN(n)) setPages(n)
                            }}
                            onBlur={() => {
                                if (!pages || pages < 1) setPages(1)
                                if (pages > 100) setPages(100)
                            }}
                        />
                        <span className="setup-hint">
                            Each page has ~25 listings. More pages = more results but takes longer.
                        </span>
                    </div>

                    {error && <div className="setup-error">{error}</div>}

                    <button type="submit" className="setup-submit" disabled={submitting}>
                        {submitting ? 'Starting...' : 'Start scraping'}
                    </button>
                </form>
            </div>
        </div>
    )
}
