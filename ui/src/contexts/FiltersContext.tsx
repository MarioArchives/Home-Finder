import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { INITIAL_FILTERS, DEFAULT_SORT } from '../config/defaults'
import { SEARCH_DEBOUNCE_MS } from '../config/constants'
import type { DrillDownFilter, FilterState } from '../types/listing'

interface FiltersContextValue {
    filters: FilterState
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>
    resetFilters: () => void
    applyDrillDown: (drill: DrillDownFilter) => void

    debouncedSearch: string
    updateSearch: (value: string) => void

    sortBy: string
    setSortBy: (s: string) => void

    customLat: string
    setCustomLat: (v: string) => void
    customLng: string
    setCustomLng: (v: string) => void
}

const FiltersContext = createContext<FiltersContextValue | null>(null)

export const FiltersProvider = ({ children }: { children: ReactNode }) => {
    const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [sortBy, setSortBy] = useState(DEFAULT_SORT)
    const [customLat, setCustomLat] = useState('')
    const [customLng, setCustomLng] = useState('')
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const updateSearch = useCallback((value: string) => {
        setFilters(prev => ({ ...prev, search: value }))
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), SEARCH_DEBOUNCE_MS)
    }, [])

    const resetFilters = useCallback(() => {
        setFilters(INITIAL_FILTERS)
        setDebouncedSearch('')
    }, [])

    const applyDrillDown = useCallback((drill: DrillDownFilter) => {
        setFilters({ ...INITIAL_FILTERS, ...drill })
        setDebouncedSearch(drill.search ?? '')
    }, [])

    return (
        <FiltersContext.Provider value={{
            filters, setFilters, resetFilters, applyDrillDown,
            debouncedSearch, updateSearch,
            sortBy, setSortBy,
            customLat, setCustomLat, customLng, setCustomLng,
        }}>
            {children}
        </FiltersContext.Provider>
    )
}

export const useFilters = (): FiltersContextValue => {
    const ctx = useContext(FiltersContext)
    if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>')
    return ctx
}
