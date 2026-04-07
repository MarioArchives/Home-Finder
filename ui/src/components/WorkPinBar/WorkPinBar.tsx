import type { WorkPinBarProps } from './properties'

export default function WorkPinBar({ workPinLat, workPinLng, commuteStatus, commuteCount, onChangePin, onRemovePin }: WorkPinBarProps) {
    if (!workPinLat || !workPinLng) return null

    return (
        <div className="pin-active-bar work-pin-bar">
            <span>&#128188; Work: {parseFloat(workPinLat).toFixed(4)}, {parseFloat(workPinLng).toFixed(4)}</span>
            {commuteStatus === 'loading' && <span className="commute-loading">Fetching commute times...</span>}
            {commuteStatus === 'done' && <span className="commute-loaded">{commuteCount} commute times loaded</span>}
            {commuteStatus === 'error' && <span className="commute-error">Could not fetch commute times (using straight-line distance)</span>}
            <button className="pin-change-btn" onClick={onChangePin}>Change</button>
            <button className="pin-change-btn" onClick={onRemovePin}>Remove</button>
        </div>
    )
}
