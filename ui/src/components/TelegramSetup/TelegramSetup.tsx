import { useState } from 'react'
import './TelegramSetup.css'

interface TelegramSetupProps {
    onComplete: () => void
    onSkip?: () => void
}

export default function TelegramSetup({ onComplete, onSkip }: TelegramSetupProps) {
    const [step, setStep] = useState<'token' | 'chat'>('token')
    const [botToken, setBotToken] = useState('')
    const [chatId, setChatId] = useState('')
    const [chatName, setChatName] = useState('')
    const [botName, setBotName] = useState('')
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [discovering, setDiscovering] = useState(false)
    const [discoveredChats, setDiscoveredChats] = useState<{ chat_id: string; name: string; type: string; already_registered?: boolean }[]>([])

    async function handleValidateToken() {
        if (!botToken.trim()) {
            setError('Please enter your bot token')
            return
        }
        setSubmitting(true)
        setError('')
        try {
            const res = await fetch('/api/telegram/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: botToken.trim() }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error || 'Failed to validate token')
                setSubmitting(false)
                return
            }
            setBotName(data.bot_name || '')
            setStep('chat')
        } catch {
            setError('Failed to connect to server')
        }
        setSubmitting(false)
    }

    async function handleDiscoverChats() {
        setDiscovering(true)
        setError('')
        try {
            const res = await fetch('/api/telegram/discover-chats', { method: 'POST' })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error || 'Failed to discover chats')
                setDiscovering(false)
                return
            }
            setDiscoveredChats(data.chats || [])
            if (data.chats?.length === 0) {
                setError('No chats found. Make sure you\'ve sent a message to your bot first, then try again.')
            } else if (data.chats?.every((c: { already_registered?: boolean }) => c.already_registered)) {
                setError('')
            }
        } catch {
            setError('Failed to connect to server')
        }
        setDiscovering(false)
    }

    async function handleSaveChat() {
        if (!chatId.trim()) {
            setError('Please enter or select a chat ID')
            return
        }
        setSubmitting(true)
        setError('')
        try {
            const res = await fetch('/api/telegram/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bot_token: botToken.trim(),
                    chat_id: chatId.trim(),
                    chat_name: chatName.trim() || 'Owner',
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error || 'Failed to save chat')
                setSubmitting(false)
                return
            }
            onComplete()
        } catch {
            setError('Failed to connect to server')
        }
        setSubmitting(false)
    }

    function selectDiscoveredChat(chat: { chat_id: string; name: string }) {
        setChatId(chat.chat_id)
        setChatName(chat.name)
    }

    return (
        <div className="telegram-setup">
            <div className="telegram-card">
                <h1>Set up Telegram notifications</h1>
                <p className="telegram-subtitle">
                    Get alerts for new property listings straight to Telegram.
                </p>

                {step === 'token' && (
                    <>
                        <div className="telegram-instructions">
                            <h3>Create a Telegram bot</h3>
                            <ol>
                                <li>Open Telegram and search for <strong>@BotFather</strong></li>
                                <li>Send <code>/newbot</code> and follow the prompts</li>
                                <li>Copy the bot token you receive</li>
                            </ol>
                        </div>

                        <div className="telegram-field">
                            <label htmlFor="bot-token">Bot token</label>
                            <input
                                id="bot-token"
                                type="text"
                                placeholder="e.g. 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                                value={botToken}
                                onChange={e => setBotToken(e.target.value)}
                                autoFocus
                            />
                        </div>

                        {error && <div className="telegram-error">{error}</div>}

                        <button
                            className="telegram-submit"
                            onClick={handleValidateToken}
                            disabled={submitting}
                        >
                            {submitting ? 'Validating...' : 'Validate token'}
                        </button>

                        {onSkip && (
                            <button className="telegram-skip" onClick={onSkip}>
                                Skip for now
                            </button>
                        )}
                    </>
                )}

                {step === 'chat' && (
                    <>
                        <div className="telegram-success-badge">
                            Connected to @{botName}
                        </div>

                        <div className="telegram-instructions">
                            <h3>Link your chat</h3>
                            <ol>
                                <li>Open Telegram and send any message to <strong>@{botName}</strong></li>
                                <li>Click "Discover chats" below, or enter your chat ID manually</li>
                            </ol>
                        </div>

                        <button
                            className="telegram-discover"
                            onClick={handleDiscoverChats}
                            disabled={discovering}
                        >
                            {discovering ? 'Searching...' : 'Discover chats'}
                        </button>

                        {discoveredChats.length > 0 && (
                            <div className="telegram-discovered">
                                {discoveredChats.map(chat => (
                                    <button
                                        key={chat.chat_id}
                                        className={`telegram-chat-option ${chatId === chat.chat_id ? 'selected' : ''} ${chat.already_registered ? 'registered' : ''}`}
                                        onClick={() => selectDiscoveredChat(chat)}
                                    >
                                        <span className="chat-name">{chat.name}</span>
                                        {chat.already_registered
                                            ? <span className="chat-badge-registered">already connected</span>
                                            : <span className="chat-id">{chat.chat_id}</span>
                                        }
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="telegram-divider">
                            <span>or enter manually</span>
                        </div>

                        <div className="telegram-field">
                            <label htmlFor="chat-id">Chat ID</label>
                            <input
                                id="chat-id"
                                type="text"
                                placeholder="e.g. 123456789"
                                value={chatId}
                                onChange={e => setChatId(e.target.value)}
                            />
                        </div>

                        <div className="telegram-field">
                            <label htmlFor="chat-name">Name (optional)</label>
                            <input
                                id="chat-name"
                                type="text"
                                placeholder="e.g. My alerts"
                                value={chatName}
                                onChange={e => setChatName(e.target.value)}
                            />
                        </div>

                        {error && <div className="telegram-error">{error}</div>}

                        <button
                            className="telegram-submit"
                            onClick={handleSaveChat}
                            disabled={submitting || !chatId.trim()}
                        >
                            {submitting ? 'Saving...' : 'Save & send test message'}
                        </button>

                        <button className="telegram-back" onClick={() => { setStep('token'); setError('') }}>
                            Back
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
