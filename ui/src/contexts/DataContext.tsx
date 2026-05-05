import { createContext, useContext, type ReactNode } from 'react'
import { useListingsData, type ListingsDataResult } from '../hooks/useListingsData'

const DataContext = createContext<ListingsDataResult | null>(null)

export const DataProvider = ({ children }: { children: ReactNode }) => {
    const value = useListingsData()
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

const useDataContext = (): ListingsDataResult => {
    const ctx = useContext(DataContext)
    if (!ctx) throw new Error('Data hooks must be used inside <DataProvider>')
    return ctx
}

export const useData = useDataContext

/** Listings + city/source metadata + reset/file-load actions. */
export const useListings = () => {
    const c = useDataContext()
    return {
        data: c.data,
        setData: c.setData,
        listings: c.listings,
        handleFileLoad: c.handleFileLoad,
    }
}

/** Setup-status gating + telegram flag. */
export const useAppStatus = () => {
    const c = useDataContext()
    return {
        appStatus: c.appStatus,
        setAppStatus: c.setAppStatus,
        telegramConfigured: c.telegramConfigured,
        setTelegramConfigured: c.setTelegramConfigured,
    }
}

/** Amenity counts + load status + manual file fallback. */
export const useNearby = () => {
    const c = useDataContext()
    return {
        nearbyCounts: c.nearbyCounts,
        setNearbyCounts: c.setNearbyCounts,
        nearbyStatus: c.nearbyStatus,
        setNearbyStatus: c.setNearbyStatus,
        handleAmenitiesFileLoad: c.handleAmenitiesFileLoad,
    }
}

/** Work-commute pin + computed commute distances per listing. */
export const useWorkPin = () => {
    const c = useDataContext()
    return {
        workPinLat: c.workPinLat,
        setWorkPinLat: c.setWorkPinLat,
        workPinLng: c.workPinLng,
        setWorkPinLng: c.setWorkPinLng,
        commuteData: c.commuteData,
        setCommuteData: c.setCommuteData,
        commuteStatus: c.commuteStatus,
        setCommuteStatus: c.setCommuteStatus,
    }
}

/** User-managed map pins + per-listing distances. */
export const useCustomPins = () => {
    const c = useDataContext()
    return {
        customPins: c.customPins,
        setCustomPins: c.setCustomPins,
        pinDistancesMap: c.pinDistancesMap,
    }
}
