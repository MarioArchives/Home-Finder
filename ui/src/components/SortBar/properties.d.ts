export interface SortBarProps {
    sortBy: string
    setSortBy: (v: string) => void
    resultCount: number
    customLat: string
    setCustomLat: (v: string) => void
    customLng: string
    setCustomLng: (v: string) => void
    workPinLat: string
    onSetWorkPin: () => void
}
