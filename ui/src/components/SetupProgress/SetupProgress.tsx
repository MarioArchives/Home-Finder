import { useState, useEffect, useRef } from 'react'
import './SetupProgress.css'

interface ProgressData {
    phase?: string
    source?: string
    current_page?: number
    total_pages?: number
    pages_done?: number
    listings_found?: number
    detail_current?: number
    detail_total?: number
    current_listing?: string
    message?: string
    error?: string | null
}

interface SetupProgressProps {
    onComplete: () => void
}

export default function SetupProgress({ onComplete }: SetupProgressProps) {
    const [progress, setProgress] = useState<ProgressData>({ phase: 'scraping', message: 'Starting...' })
    const [error, setError] = useState<string | null>(null)
    const esRef = useRef<EventSource | null>(null)

    useEffect(() => {
        const es = new EventSource('/api/setup/progress')
        esRef.current = es

        es.onmessage = (event) => {
            try {
                const data: ProgressData = JSON.parse(event.data)
                setProgress(data)

                if (data.phase === 'complete') {
                    es.close()
                    setTimeout(onComplete, 1000)
                }
                if (data.phase === 'error') {
                    es.close()
                    setError(data.error || 'Something went wrong')
                }
            } catch { /* ignore parse errors */ }
        }

        es.onerror = () => {
            es.close()
            setError('Lost connection to server')
        }

        return () => { es.close() }
    }, [onComplete])

    function handleRetry() {
        setError(null)
        window.location.reload()
    }

    const phase = progress.phase
    const isScraping = phase === 'scraping'
    const isAmenities = phase === 'amenities'
    const isComplete = phase === 'complete'

    // Calculate percentage for the progress bar
    let percent = 0
    if (isScraping && progress.total_pages && progress.total_pages > 0) {
        const pagesDone = progress.pages_done ?? 0
        // Each page has a detail-fetching sub-step
        let pageProgress = 0
        if (progress.detail_current != null && progress.detail_total != null && progress.detail_total > 0) {
            pageProgress = progress.detail_current / progress.detail_total
        }
        // Scraping is 80% of total, amenities is 20%
        percent = ((pagesDone + pageProgress) / progress.total_pages) * 80
    } else if (isAmenities) {
        percent = 85
    } else if (isComplete) {
        percent = 100
    }

    return (
        <div className="setup-progress">
            <div className="progress-card">
                <h1>{error ? 'Setup failed' : isComplete ? 'Ready!' : 'Setting up...'}</h1>

                {error ? (
                    <>
                        <div className="progress-error">{error}</div>
                        <button className="progress-retry" onClick={handleRetry}>Try again</button>
                    </>
                ) : (
                    <>
                        <div className="progress-phases">
                            <div className={`progress-phase ${isScraping ? 'active' : isAmenities || isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Scraping listings</span>
                            </div>
                            <div className="progress-phase-line" />
                            <div className={`progress-phase ${isAmenities ? 'active' : isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Fetching amenities</span>
                            </div>
                            <div className="progress-phase-line" />
                            <div className={`progress-phase ${isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Ready</span>
                            </div>
                        </div>

                        {isScraping && (
                            <div className="progress-details">
                                {progress.source && (
                                    <div className="progress-source">
                                        Source: <strong>{progress.source}</strong>
                                    </div>
                                )}
                                {progress.current_page != null && progress.current_page > 0 && progress.total_pages != null && (
                                    <div className="progress-stat">
                                        Page {progress.current_page} of {progress.total_pages}
                                    </div>
                                )}
                                {progress.detail_current != null && progress.detail_total != null && (
                                    <div className="progress-stat">
                                        Fetching details: {progress.detail_current} / {progress.detail_total}
                                    </div>
                                )}
                                {(progress.listings_found ?? 0) > 0 && (
                                    <div className="progress-stat listings-count">
                                        {progress.listings_found} listings found
                                    </div>
                                )}
                                {progress.current_listing && (
                                    <div className="progress-listing">{progress.current_listing}</div>
                                )}
                            </div>
                        )}

                        {isAmenities && (
                            <div className="progress-details">
                                <div className="progress-stat">Querying nearby bars, cafes, shops, gyms...</div>
                            </div>
                        )}

                        {isComplete && (
                            <div className="progress-details">
                                <div className="progress-stat">Loading your properties...</div>
                            </div>
                        )}

                        <div className="progress-bar-container">
                            <div className="progress-bar-track">
                                <div
                                    className={`progress-bar-fill ${percent === 0 ? 'indeterminate' : ''}`}
                                    style={percent > 0 ? { width: `${Math.min(percent, 100)}%` } : undefined}
                                />
                            </div>
                            {percent > 0 && (
                                <span className="progress-bar-label">{Math.round(percent)}%</span>
                            )}
                        </div>

                        <p className="progress-hint">
                            This may take a while depending on how many pages you selected.
                            You can leave this tab open — progress will continue in the background.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
