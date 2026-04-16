import { useState } from 'react'
import { PinPickerInner } from '../PinPicker/PinPicker'
import EmojiSelection from './EmojiSelection'
import type { CustomPinsBarProps } from './properties'

export default function CustomPinsBar({ customPins, setCustomPins }: CustomPinsBarProps) {
    const [showAddPopup, setShowAddPopup] = useState(false)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false)
    const [pendingEmoji, setPendingEmoji] = useState('📍')
    const [pendingLabel, setPendingLabel] = useState('')

    function openPopup() {
        setPendingEmoji('📍')
        setPendingLabel('')
        setShowAddPopup(true)
    }

    function handleConfirm(lat: number, lng: number) {
        if (!pendingLabel.trim()) return
        setCustomPins((prev) => [...prev, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label: pendingLabel.trim(),
            emoji: pendingEmoji || '📍',
            lat, lng,
        }])
        setShowAddPopup(false)
    }

    return (
        <>
            <div className="custom-pins-bar">
                {customPins.map((pin) => (
                    <span key={pin.id} className="custom-pin-chip">
                        <span className="custom-pin-emoji">{pin.emoji}</span>
                        <span className="custom-pin-label">{pin.label}</span>
                        <button className="custom-pin-remove" title={`Remove ${pin.label}`}
                            onClick={() => setCustomPins((prev) => prev.filter((p) => p.id !== pin.id))}>&times;</button>
                    </span>
                ))}
                <button className="btn-add-pin" onClick={openPopup}>+ Add pin</button>
            </div>

            {showAddPopup && (
                <div className="pin-picker-overlay" onClick={() => setShowAddPopup(false)}>
                    <div className="pin-picker-popup add-pin-popup" onClick={(e) => e.stopPropagation()}>
                        <div className="pin-picker-header">
                            <span className="pin-picker-label">Add a custom pin</span>
                            <button className="pin-picker-close" onClick={() => setShowAddPopup(false)}>&times;</button>
                        </div>
                        <div className="add-pin-fields">
                            <div className="add-pin-field">
                                <label>Emoji</label>
                                <button type="button" className="add-pin-emoji-input" onClick={() => setShowEmojiPicker(true)}>{pendingEmoji}</button>
                            </div>
                            <div className="add-pin-field add-pin-field-grow">
                                <label>Label</label>
                                <input type="text" placeholder="e.g. Office, Mum's house, Gym..." value={pendingLabel} onChange={(e) => setPendingLabel(e.target.value)} autoFocus />
                            </div>
                        </div>
                        <div className="add-pin-hint">Click the map to place the pin, then confirm.</div>
                        <PinPickerInner onConfirm={handleConfirm} />
                    </div>
                </div>
            )}

            {showEmojiPicker && (
                <EmojiSelection
                    onSelect={(emoji) => setPendingEmoji(emoji)}
                    onClose={() => setShowEmojiPicker(false)}
                />
            )}
        </>
    )
}
