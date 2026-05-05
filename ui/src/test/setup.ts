import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './handlers'

// matchMedia not in jsdom — recharts/react-leaflet probe it.
if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }))
}

class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
    root = null
    rootMargin = ''
    thresholds = []
}
;(globalThis as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver = IO

class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
    server.resetHandlers()
    localStorage.clear()
})
afterAll(() => server.close())
