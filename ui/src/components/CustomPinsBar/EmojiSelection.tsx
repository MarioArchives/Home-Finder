const ALLOWED_EMOJIS = [
    '\u{1F4CD}', // 📍 pin
    '\u{1F3E0}', // 🏠 home
    '\u{1F3E2}', // 🏢 office
    '\u{1F3EB}', // 🏫 school
    '\u{1F3E5}', // 🏥 hospital
    '\u{1F3EA}', // 🏪 shop
    '\u{1F6D2}', // 🛒 supermarket
    '\u{1F3CB}\u{FE0F}', // 🏋️ gym
    '\u{1F9D7}', // 🧗 climbing
    '\u{26BD}', // ⚽ sports
    '\u{1F3DF}\u{FE0F}', // 🏟️ stadium
    '\u{1F3AC}', // 🎬 cinema
    '\u{1F3A8}', // 🎨 art
    '\u{1F3B5}', // 🎵 music
    '\u{1F4DA}', // 📚 library
    '\u{1F37A}', // 🍺 pub
    '\u{2615}', // ☕ cafe
    '\u{1F374}', // 🍴 restaurant
    '\u{1F333}', // 🌳 park
    '\u{1F6B2}', // 🚲 cycling
    '\u{1F686}', // 🚆 train
    '\u{1F687}', // 🚇 metro
    '\u{1F68C}', // 🚌 bus
    '\u{2708}\u{FE0F}', // ✈️ airport
    '\u{2764}\u{FE0F}', // ❤️ favourite
    '\u{2B50}', // ⭐ star
    '\u{1F4BC}', // 💼 work
    '\u{1F469}\u{200D}\u{1F467}', // 👩‍👧 family
    '\u{1F415}', // 🐕 dog
    '\u{1F343}', // 🍃 nature
]

export default function EmojiSelection({ onSelect, onClose }: {
    onSelect: (emoji: string) => void
    onClose: () => void
}) {
    return (
        <div className="emoji-selection-overlay" onClick={onClose}>
            <div className="emoji-selection-popup" onClick={(e) => e.stopPropagation()}>
                <div className="pin-picker-header">
                    <span className="pin-picker-label">Pick an emoji</span>
                    <button className="pin-picker-close" onClick={onClose}>&times;</button>
                </div>
                <div className="emoji-selection-grid">
                    {ALLOWED_EMOJIS.map((emoji) => (
                        <button
                            key={emoji}
                            className="emoji-selection-item"
                            onClick={() => { onSelect(emoji); onClose() }}
                            type="button"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
