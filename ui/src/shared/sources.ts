import { useEffect, useReducer } from 'react'

export interface SourceMeta {
    name: string
    label: string
    icon: string
    color: string
    bg: string
    supports_buy: boolean
}

const FALLBACK_DEFAULTS: SourceMeta = {
    name: '',
    label: '',
    icon: '\u{1F3E0}',
    color: '#6b7280',
    bg: 'rgba(107, 114, 128, 0.12)',
    supports_buy: true,
}

// The provider registry lives on the backend (see src/providers/) and is
// served by `/api/sources`. We never duplicate the source list here — every
// piece of UI metadata (label/icon/color/supports_buy) is owned by the
// provider class. Until the fetch resolves, sourceMeta() returns the
// `FALLBACK_DEFAULTS` (with the slug as the label). `ensureSourcesLoaded()`
// is invoked from App.tsx at module load so this gap is typically a single
// frame.
let cache: Record<string, SourceMeta> = {}
let cacheOrder: string[] = []
const subscribers = new Set<() => void>()
let fetchPromise: Promise<void> | null = null

function notify() {
    subscribers.forEach(fn => fn())
}

export function ensureSourcesLoaded(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = fetch('/api/sources')
        .then(r => {
            if (!r.ok) throw new Error('sources fetch failed')
            return r.json()
        })
        .then((data: { sources: Array<Omit<SourceMeta, 'label'> & { display_name: string }> }) => {
            const next: Record<string, SourceMeta> = {}
            const order: string[] = []
            for (const s of data.sources || []) {
                next[s.name] = {
                    name: s.name,
                    label: s.display_name || s.name,
                    icon: s.icon,
                    color: s.color,
                    bg: s.bg,
                    supports_buy: s.supports_buy,
                }
                order.push(s.name)
            }
            cache = next
            cacheOrder = order
            notify()
        })
        .catch(() => {
            // Keep the seed; UI continues to function.
        })
    return fetchPromise
}

export function sourceMeta(name: string): SourceMeta {
    const hit = cache[name]
    if (hit) return hit
    return {
        ...FALLBACK_DEFAULTS,
        name,
        label: name.charAt(0).toUpperCase() + name.slice(1),
    }
}

export function useSources(): SourceMeta[] {
    const [, force] = useReducer((n: number) => n + 1, 0)
    useEffect(() => {
        ensureSourcesLoaded()
        subscribers.add(force)
        return () => { subscribers.delete(force) }
    }, [])
    return cacheOrder.map(n => cache[n])
}
