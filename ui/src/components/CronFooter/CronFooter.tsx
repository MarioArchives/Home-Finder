import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { sourceMeta } from '../../shared/sources'
import './CronFooter.css'

type SourceState = {
    pages_done: number
    total_pages: number
    detail_current: number
    detail_total: number
    percent: number
}

type StageName = 'scrape' | 'amenities' | 'alerts'
type StageState = 'pending' | 'ok' | 'failing' | 'stale'

type StageInfo = {
    last_ok: string | null
    last_attempt: string | null
    last_error: string | null
    attempts_today: number
    state: StageState
}

type CronStatus = {
    running: boolean
    job: 'scrape' | 'alerts' | 'amenities' | null
    percent: number | null
    sources?: Record<string, SourceState>
    total_pages?: number
    last_scrape: string | null
    stages?: Record<StageName, StageInfo>
    status_summary?: string | null
}

const JOB_LABEL: Record<NonNullable<CronStatus['job']>, string> = {
    scrape: 'Scraping listings',
    alerts: 'Checking alerts',
    amenities: 'Refreshing amenities',
}

const STAGE_LABEL: Record<StageName, string> = {
    scrape: 'Scrape',
    amenities: 'Amenities',
    alerts: 'Alerts',
}

const STAGE_ORDER: StageName[] = ['scrape', 'amenities', 'alerts']

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
    const stages = status.stages ?? null

    const activeDots: string[] = status.running && status.job === 'scrape'
        ? sourceEntries
            .filter(([, s]) => s.percent < 100)
            .map(([name]) => sourceMeta(name).color)
        : []

    const errorState = stages
        ? STAGE_ORDER.some(n => stages[n]?.state === 'failing' || stages[n]?.state === 'stale')
        : false
    const summary = status.status_summary ?? null

    let footer: ReactNode
    if (status.running && status.job) {
        footer = (
            <footer className="cron-footer cron-footer--running">
                <span className="cron-footer__dot" />
                <strong>{JOB_LABEL[status.job]}</strong>
                {activeDots.length > 0 && (
                    <span className="cron-footer__source-dots" aria-hidden>
                        {activeDots.map((c, i) => (
                            <span key={i} className="cron-footer__source-dot" style={{ background: c }} />
                        ))}
                    </span>
                )}
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
        )
    } else if (errorState && summary) {
        footer = (
            <button
                type="button"
                className="cron-footer cron-footer--error"
                onClick={() => setOpen(true)}
                aria-label="Show pipeline status"
            >
                <span className="cron-footer__dot" />
                <strong>Pipeline issue</strong>
                <span className="cron-footer__msg">{summary}</span>
            </button>
        )
    } else {
        footer = (
            <button
                type="button"
                className="cron-footer cron-footer--idle"
                onClick={() => setOpen(true)}
                aria-label="Show pipeline status"
            >
                <span className="cron-footer__dot" />
                <strong>Up to date</strong>
                <span className="cron-footer__msg">last scrape {formatRelative(status.last_scrape)}</span>
            </button>
        )
    }

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
                            {stages && (
                                <div className="cron-modal__stages">
                                    {STAGE_ORDER.map(name => {
                                        const info = stages[name]
                                        if (!info) return null
                                        return (
                                            <div key={name} className={`cron-stage cron-stage--${info.state}`}>
                                                <div className="cron-stage__head">
                                                    <span className="cron-stage__name">
                                                        <span className={`cron-stage__pip cron-stage__pip--${info.state}`} aria-hidden />
                                                        {STAGE_LABEL[name]}
                                                    </span>
                                                    <span className="cron-stage__state">{info.state}</span>
                                                </div>
                                                <div className="cron-stage__meta">
                                                    {info.last_ok && <span>last ok {formatRelative(info.last_ok)}</span>}
                                                    {info.attempts_today > 0 && (
                                                        <span>{info.attempts_today} attempt{info.attempts_today === 1 ? '' : 's'} today</span>
                                                    )}
                                                </div>
                                                {info.last_error && (
                                                    <div className="cron-stage__error">{info.last_error}</div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

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

                            {sourceEntries.length > 0 && (
                                <div className="cron-modal__sources">
                                    {sourceEntries.map(([name, s]) => {
                                        const meta = sourceMeta(name)
                                        const done = s.percent >= 100
                                        return (
                                            <div key={name} className="cron-modal__source">
                                                <div className="cron-modal__row-head">
                                                    <span className="cron-modal__src-name" style={{ color: meta.color }}>
                                                        <span
                                                            className="cron-modal__src-dot"
                                                            style={{ background: done ? 'var(--green)' : meta.color }}
                                                            aria-hidden
                                                        />
                                                        {meta.label}
                                                    </span>
                                                    <span className="cron-modal__pct">{Math.round(s.percent)}%</span>
                                                </div>
                                                <div className="cron-modal__bar">
                                                    <div
                                                        className="cron-modal__bar-fill"
                                                        style={{ width: `${s.percent}%`, background: meta.color }}
                                                    />
                                                </div>
                                                <div className="cron-modal__meta">
                                                    <span>page {s.pages_done}/{s.total_pages}</span>
                                                    {s.detail_total > 0 && (
                                                        <span>detail {s.detail_current}/{s.detail_total}</span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                            {!stages && sourceEntries.length === 0 && (
                                <div className="cron-modal__empty">No pipeline status available.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
