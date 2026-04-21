import { useEffect, useState } from 'react'
import './CronFooter.css'

type SourceState = {
    pages_done: number
    total_pages: number
    detail_current: number
    detail_total: number
    percent: number
}

type CronStatus = {
    running: boolean
    job: 'scrape' | 'alerts' | 'amenities' | null
    percent: number | null
    sources?: Record<string, SourceState>
    total_pages?: number
    last_scrape: string | null
}

const JOB_LABEL: Record<NonNullable<CronStatus['job']>, string> = {
    scrape: 'Scraping listings',
    alerts: 'Checking alerts',
    amenities: 'Refreshing amenities',
}

function formatRelative(iso: string | null): string {
    if (!iso) return 'never'
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 'unknown'
    const mins = Math.round((Date.now() - then) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
}

export default function CronFooter() {
    const [status, setStatus] = useState<CronStatus | null>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        async function poll() {
            try {
                const res = await fetch('/api/cron/status')
                if (!res.ok) return
                const data = (await res.json()) as CronStatus
                if (!cancelled) setStatus(data)
            } catch {
                // Network hiccup — retry on next tick.
            }
        }
        poll()
        const id = setInterval(poll, 5000)
        return () => { cancelled = true; clearInterval(id) }
    }, [])

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open])

    if (!status) return null

    const sources = status.sources ?? {}
    const sourceEntries = Object.entries(sources)

    const footer = status.running && status.job ? (
        <footer className="cron-footer cron-footer--running">
            <span className="cron-footer__dot" />
            <strong>{JOB_LABEL[status.job]}</strong>
            <button
                type="button"
                className="cron-footer__bar"
                onClick={() => setOpen(true)}
                aria-label="Show scrape details"
                role="progressbar"
                aria-valuenow={Math.round(status.percent ?? 0)}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div className="cron-footer__bar-fill" style={{ width: `${Math.max(0, Math.min(100, status.percent ?? 0))}%` }} />
            </button>
            <span className="cron-footer__pct">{Math.round(status.percent ?? 0)}%</span>
        </footer>
    ) : (
        <footer className="cron-footer cron-footer--idle">
            <span className="cron-footer__dot" />
            <strong>Scraping completed</strong>
            <span className="cron-footer__msg">last scrape {formatRelative(status.last_scrape)}</span>
        </footer>
    )

    return (
        <>
            {footer}
            {open && (
                <div className="cron-modal-overlay" onClick={() => setOpen(false)}>
                    <div className="cron-modal" onClick={e => e.stopPropagation()}>
                        <div className="cron-modal__header">
                            <div>
                                <div className="cron-modal__title">{status.job ? JOB_LABEL[status.job] : 'Scraping details'}</div>
                                <div className="cron-modal__subtitle">
                                    {status.running ? 'In progress' : 'Idle'} · last scrape {formatRelative(status.last_scrape)}
                                </div>
                            </div>
                            <button className="cron-modal__close" onClick={() => setOpen(false)} aria-label="Close">&times;</button>
                        </div>

                        <div className="cron-modal__body">
                            {status.percent !== null && (
                                <div className="cron-modal__overall">
                                    <div className="cron-modal__row-head">
                                        <span>Overall</span>
                                        <span className="cron-modal__pct">{Math.round(status.percent)}%</span>
                                    </div>
                                    <div className="cron-modal__bar">
                                        <div className="cron-modal__bar-fill" style={{ width: `${status.percent}%` }} />
                                    </div>
                                </div>
                            )}

                            {sourceEntries.length > 0 ? (
                                <div className="cron-modal__sources">
                                    {sourceEntries.map(([name, s]) => (
                                        <div key={name} className="cron-modal__source">
                                            <div className="cron-modal__row-head">
                                                <span className="cron-modal__src-name">{name}</span>
                                                <span className="cron-modal__pct">{Math.round(s.percent)}%</span>
                                            </div>
                                            <div className="cron-modal__bar">
                                                <div className="cron-modal__bar-fill" style={{ width: `${s.percent}%` }} />
                                            </div>
                                            <div className="cron-modal__meta">
                                                <span>page {s.pages_done}/{s.total_pages}</span>
                                                {s.detail_total > 0 && (
                                                    <span>detail {s.detail_current}/{s.detail_total}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="cron-modal__empty">No per-source progress available.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
