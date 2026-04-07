import type { ChangeEvent } from 'react'

export interface AppHeaderProps {
    city: string
    listingType: string
    filteredCount: number
    totalCount: number
    scrapedAt?: string
    nearbyStatus: 'idle' | 'loading' | 'done' | 'error'
    onLoadAmenitiesFile: (e: ChangeEvent<HTMLInputElement>) => void
    onReset: () => void
}
