import { useState, useEffect, useRef } from 'react'
import EmojiSelection from '../CustomPinsBar/EmojiSelection'
import { PinPickerInner } from '../PinPicker/PinPicker'
import './SetupProgress.css'

interface ProgressData {
    phase?: string
    source?: string
    current_page?: number
    total_pages?: number
    pages_done?: number
    listings_found?: number
    detail_current?: number
    detail_total?: number
    current_listing?: string
    message?: string
    error?: string | null
    awaiting_preferences?: boolean
    preferences_submitted?: boolean
}

interface SetupProgressProps {
    onComplete: () => void
    onTelegramConfigured?: () => void
}

const AMENITY_LABELS: Record<string, { label: string; icon: string }> = {
    climbing: { label: 'Climbing gyms', icon: '\u{1F9D7}' },
    cinema: { label: 'Cinemas', icon: '\u{1F3AC}' },
    gym: { label: 'Gyms & fitness', icon: '\u{1F3CB}' },
    parks: { label: 'Parks', icon: '\u{1F333}' },
}

export default function SetupProgress({ onComplete, onTelegramConfigured }: SetupProgressProps) {
    const [progress, setProgress] = useState<ProgressData>({ phase: 'scraping', message: 'Starting...' })
    const [error, setError] = useState<string | null>(null)
    const esRef = useRef<EventSource | null>(null)

    // Preferences state
    const [amenities, setAmenities] = useState<Record<string, boolean>>({
        climbing: true, cinema: false, gym: false, parks: false,
    })
    const [showPin, setShowPin] = useState(false)
    const [pinLabel, setPinLabel] = useState('')
    const [pinEmoji, setPinEmoji] = useState('\u{1F4CD}')
    const [pinLat, setPinLat] = useState<number | null>(null)
    const [pinLng, setPinLng] = useState<number | null>(null)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false)
    const [prefsSaved, setPrefsSaved] = useState(false)
    const [prefsSaving, setPrefsSaving] = useState(false)

    // Telegram bot state
    const [showTelegram, setShowTelegram] = useState(false)
    const [botToken, setBotToken] = useState('')
    const [botName, setBotName] = useState('')
    const [botConnected, setBotConnected] = useState(false)
    const [botSubmitting, setBotSubmitting] = useState(false)
    const [botError, setBotError] = useState('')
    const [discovering, setDiscovering] = useState(false)
    const [discoveredChats, setDiscoveredChats] = useState<{ chat_id: string; name: string; type: string }[]>([])
    const [selectedChat, setSelectedChat] = useState<{ chat_id: string; name: string } | null>(null)
    const [manualChatId, setManualChatId] = useState('')
    const [chatSaved, setChatSaved] = useState(false)
    const [chatSaving, setChatSaving] = useState(false)

    useEffect(() => {
        const es = new EventSource('/api/setup/progress')
        esRef.current = es

        es.onmessage = (event) => {
            try {
                const data: ProgressData = JSON.parse(event.data)
                setProgress(data)

                // If server says prefs were already submitted (e.g. page refresh), reflect that
                if (data.preferences_submitted) setPrefsSaved(true)

                if (data.phase === 'complete') {
                    es.close()
                    setTimeout(onComplete, 1000)
                }
                if (data.phase === 'error') {
                    es.close()
                    setError(data.error || 'Something went wrong')
                }
            } catch { /* ignore parse errors */ }
        }

        es.onerror = () => {
            es.close()
            setError('Lost connection to server')
        }

        return () => { es.close() }
    }, [onComplete])

    async function savePreferences() {
        setPrefsSaving(true)
        try {
            const body: Record<string, unknown> = {
                amenities: Object.entries(amenities).filter(([, v]) => v).map(([k]) => k).join(',') || 'climbing',
            }
            if (showPin && pinLat != null && pinLng != null && pinLabel.trim()) {
                body.pin_data = {
                    lat: pinLat, lng: pinLng,
                    label: pinLabel.trim(),
                    emoji: pinEmoji || '\u{1F4CD}',
                }
            }
            const res = await fetch('/api/setup/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            if (res.ok) setPrefsSaved(true)
        } catch { /* ignore */ }
        setPrefsSaving(false)
    }

    async function connectBot() {
        if (!botToken.trim()) { setBotError('Please enter a bot token'); return }
        setBotSubmitting(true)
        setBotError('')
        try {
            const res = await fetch('/api/telegram/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: botToken.trim() }),
            })
            const data = await res.json()
            if (!res.ok) {
                setBotError(data.error || 'Failed to validate bot token')
            } else {
                setBotName(data.bot_name || 'Bot')
                setBotConnected(true)
            }
        } catch {
            setBotError('Failed to connect to server')
        }
        setBotSubmitting(false)
    }

    async function discoverChats() {
        setDiscovering(true)
        setBotError('')
        try {
            const res = await fetch('/api/telegram/discover-chats', { method: 'POST' })
            const data = await res.json()
            if (!res.ok) {
                setBotError(data.error || 'Failed to discover chats')
            } else {
                setDiscoveredChats(data.chats || [])
                if ((data.chats || []).length === 0) {
                    setBotError('No new chats found. Message your bot on Telegram first, then try again.')
                }
            }
        } catch {
            setBotError('Failed to connect to server')
        }
        setDiscovering(false)
    }

    async function saveChat() {
        const chatId = selectedChat?.chat_id || manualChatId.trim()
        const chatName = selectedChat?.name || manualChatId.trim()
        if (!chatId) return
        setChatSaving(true)
        setBotError('')
        try {
            // Save the full setup (token + chat_id) so alerts work
            const res = await fetch('/api/telegram/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: botToken.trim(), chat_id: chatId, chat_name: chatName }),
            })
            const data = await res.json()
            if (!res.ok) {
                setBotError(data.error || 'Failed to save chat')
            } else {
                setChatSaved(true)
                onTelegramConfigured?.()
            }
        } catch {
            setBotError('Failed to connect to server')
        }
        setChatSaving(false)
    }

    function handleRetry() {
        setError(null)
        window.location.reload()
    }

    const phase = progress.phase
    const isScraping = phase === 'scraping'
    const isAmenities = phase === 'amenities'
    const isComplete = phase === 'complete'
    const awaitingPrefs = progress.awaiting_preferences && !prefsSaved

    // Calculate percentage for the progress bar
    let percent = 0
    if (isScraping && progress.total_pages && progress.total_pages > 0) {
        const pagesDone = progress.pages_done ?? 0
        let pageProgress = 0
        if (progress.detail_current != null && progress.detail_total != null && progress.detail_total > 0) {
            pageProgress = progress.detail_current / progress.detail_total
        }
        percent = ((pagesDone + pageProgress) / progress.total_pages) * 80
    } else if (isAmenities) {
        percent = 85
    } else if (isComplete) {
        percent = 100
    }

    const showPrefsPanel = isScraping && !prefsSaved

    return (
        <div className="setup-progress">
            <div className={`progress-card ${showPrefsPanel ? 'with-preferences' : ''}`}>
                <h1>{error ? 'Setup failed' : isComplete ? 'Ready!' : 'Setting up...'}</h1>

                {error ? (
                    <>
                        <div className="progress-error">{error}</div>
                        <button className="progress-retry" onClick={handleRetry}>Try again</button>
                    </>
                ) : (
                    <>
                        <div className="progress-phases">
                            <div className={`progress-phase ${isScraping ? 'active' : isAmenities || isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Scraping listings</span>
                            </div>
                            <div className="progress-phase-line" />
                            <div className={`progress-phase ${isAmenities ? 'active' : isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Fetching amenities</span>
                            </div>
                            <div className="progress-phase-line" />
                            <div className={`progress-phase ${isComplete ? 'done' : ''}`}>
                                <span className="phase-dot" />
                                <span>Ready</span>
                            </div>
                        </div>

                        {isScraping && !progress.awaiting_preferences && (
                            <div className="progress-details">
                                {progress.source && (
                                    <div className="progress-source">
                                        Source: <strong>{progress.source}</strong>
                                    </div>
                                )}
                                {progress.current_page != null && progress.current_page > 0 && progress.total_pages != null && (
                                    <div className="progress-stat">
                                        Page {progress.current_page} of {progress.total_pages}
                                    </div>
                                )}
                                {progress.detail_current != null && progress.detail_total != null && (
                                    <div className="progress-stat">
                                        Fetching details: {progress.detail_current} / {progress.detail_total}
                                    </div>
                                )}
                                {(progress.listings_found ?? 0) > 0 && (
                                    <div className="progress-stat listings-count">
                                        {progress.listings_found} listings found
                                    </div>
                                )}
                                {progress.current_listing && (
                                    <div className="progress-listing">{progress.current_listing}</div>
                                )}
                            </div>
                        )}

                        {isAmenities && (
                            <div className="progress-details">
                                <div className="progress-stat">Querying nearby bars, cafes, shops, gyms...</div>
                            </div>
                        )}

                        {isComplete && (
                            <div className="progress-details">
                                <div className="progress-stat">Loading your properties...</div>
                            </div>
                        )}

                        <div className="progress-bar-container">
                            <div className="progress-bar-track">
                                <div
                                    className={`progress-bar-fill ${percent === 0 ? 'indeterminate' : ''}`}
                                    style={percent > 0 ? { width: `${Math.min(percent, 100)}%` } : undefined}
                                />
                            </div>
                            {percent > 0 && (
                                <span className="progress-bar-label">{Math.round(percent)}%</span>
                            )}
                        </div>

                        {/* Preferences panel — shown while scraping */}
                        {showPrefsPanel && (
                            <div className="progress-preferences">
                                <h2>While you wait, configure your preferences</h2>

                                <div className="setup-field">
                                    <label>Nearby amenities to search</label>
                                    <span className="setup-hint">
                                        Bars, cafes, and shops are always included. Select additional types to find nearby.
                                    </span>
                                    <div className="setup-amenities">
                                        {Object.entries(AMENITY_LABELS).map(([key, { label, icon }]) => (
                                            <label key={key} className="setup-amenity-option">
                                                <input
                                                    type="checkbox"
                                                    checked={amenities[key]}
                                                    onChange={e => setAmenities(prev => ({ ...prev, [key]: e.target.checked }))}
                                                />
                                                <span className="amenity-icon">{icon}</span> {label}
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="setup-field">
                                    <label className="setup-amenity-option setup-pin-toggle">
                                        <input
                                            type="checkbox"
                                            checked={showPin}
                                            onChange={e => { setShowPin(e.target.checked); if (!e.target.checked) { setPinLat(null); setPinLng(null) } }}
                                        />
                                        <span className="amenity-icon">{'\u{1F4CD}'}</span> Set a location pin
                                    </label>
                                    <span className="setup-hint">
                                        Optionally drop a pin to track distance from each property to a specific location.
                                    </span>
                                    {showPin && (
                                        <div className="setup-pin-section">
                                            <div className="setup-pin-inputs">
                                                <button
                                                    type="button"
                                                    className="setup-pin-emoji-btn"
                                                    onClick={() => setShowEmojiPicker(true)}
                                                >
                                                    {pinEmoji}
                                                </button>
                                                <input
                                                    type="text"
                                                    placeholder="Label (e.g. Office, Gym)"
                                                    value={pinLabel}
                                                    onChange={e => setPinLabel(e.target.value)}
                                                    className="setup-pin-label"
                                                />
                                            </div>
                                            {pinLat != null && pinLng != null && (
                                                <div className="setup-pin-coords">
                                                    Pin set: {pinLat.toFixed(4)}, {pinLng.toFixed(4)}
                                                </div>
                                            )}
                                            <PinPickerInner onConfirm={(lat, lng) => { setPinLat(lat); setPinLng(lng) }} />
                                        </div>
                                    )}
                                </div>

                                <div className="setup-field">
                                    <label className="setup-amenity-option setup-pin-toggle">
                                        <input
                                            type="checkbox"
                                            checked={showTelegram}
                                            onChange={e => setShowTelegram(e.target.checked)}
                                        />
                                        <span className="amenity-icon">{'\u{1F514}'}</span> Connect Telegram bot
                                    </label>
                                    <span className="setup-hint">
                                        Optionally connect a Telegram bot to receive alerts for new listings.
                                    </span>
                                    {showTelegram && (
                                        <div className="setup-telegram-section">
                                            {!botConnected ? (
                                                <>
                                                    <ol className="telegram-steps">
                                                        <li>Message <strong>@BotFather</strong> on Telegram</li>
                                                        <li>Send <code>/newbot</code> and follow the prompts</li>
                                                        <li>Paste the token below</li>
                                                    </ol>
                                                    <div className="setup-telegram-inputs">
                                                        <input
                                                            type="text"
                                                            placeholder="Bot token"
                                                            value={botToken}
                                                            onChange={e => setBotToken(e.target.value)}
                                                            className="setup-telegram-token"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="setup-telegram-connect"
                                                            onClick={connectBot}
                                                            disabled={botSubmitting}
                                                        >
                                                            {botSubmitting ? 'Connecting...' : 'Connect'}
                                                        </button>
                                                    </div>
                                                </>
                                            ) : chatSaved ? (
                                                <div className="telegram-connected">
                                                    Connected to <strong>@{botName}</strong> — alerts will be sent to your chat
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="telegram-connected">
                                                        Connected to <strong>@{botName}</strong>
                                                    </div>
                                                    <p className="setup-hint" style={{ margin: '8px 0' }}>
                                                        Now send any message to your bot on Telegram, then click discover to find your chat.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        className="setup-telegram-connect"
                                                        onClick={discoverChats}
                                                        disabled={discovering}
                                                        style={{ marginBottom: 8 }}
                                                    >
                                                        {discovering ? 'Searching...' : 'Discover chats'}
                                                    </button>
                                                    {discoveredChats.length > 0 && (
                                                        <div className="setup-telegram-chats">
                                                            {discoveredChats.map(chat => (
                                                                <button
                                                                    key={chat.chat_id}
                                                                    type="button"
                                                                    className={`setup-telegram-chat-option ${selectedChat?.chat_id === chat.chat_id ? 'selected' : ''}`}
                                                                    onClick={() => setSelectedChat(chat)}
                                                                >
                                                                    <strong>{chat.name}</strong>
                                                                    <span className="chat-type">{chat.type}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="setup-telegram-divider">
                                                        <span>or enter chat ID manually</span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Chat ID"
                                                        value={selectedChat ? selectedChat.chat_id : manualChatId}
                                                        onChange={e => { setSelectedChat(null); setManualChatId(e.target.value) }}
                                                        className="setup-telegram-token"
                                                    />
                                                    <button
                                                        type="button"
                                                        className="setup-telegram-connect"
                                                        onClick={saveChat}
                                                        disabled={chatSaving || (!selectedChat && !manualChatId.trim())}
                                                        style={{ marginTop: 8 }}
                                                    >
                                                        {chatSaving ? 'Saving...' : 'Save chat'}
                                                    </button>
                                                </>
                                            )}
                                            {botError && <div className="setup-telegram-error">{botError}</div>}
                                        </div>
                                    )}
                                </div>

                                <button
                                    className={`setup-submit ${awaitingPrefs ? 'pulse' : ''}`}
                                    onClick={savePreferences}
                                    disabled={prefsSaving}
                                >
                                    {prefsSaving ? 'Saving...' : awaitingPrefs ? 'Save preferences to continue' : 'Save preferences'}
                                </button>
                            </div>
                        )}

                        {prefsSaved && isScraping && (
                            <div className="preferences-saved">Preferences saved</div>
                        )}

                        {!showPrefsPanel && isScraping && !prefsSaved && (
                            <p className="progress-hint">
                                This may take a while depending on how many pages you selected.
                            </p>
                        )}
                    </>
                )}
            </div>

            {showEmojiPicker && (
                <EmojiSelection
                    onSelect={(emoji) => setPinEmoji(emoji)}
                    onClose={() => setShowEmojiPicker(false)}
                />
            )}
        </div>
    )
}
