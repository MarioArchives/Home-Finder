export interface WorkPinBarProps {
    workPinLat: string
    workPinLng: string
    commuteStatus: 'idle' | 'loading' | 'done' | 'error'
    commuteCount: number
    onChangePin: () => void
    onRemovePin: () => void
}
