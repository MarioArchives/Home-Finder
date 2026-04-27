import { useState, useEffect } from 'react'

export function isoToDMY(iso: string): string {
    if (!iso) return ''
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}

export function dmyToISO(text: string): string | null {
    if (!text.trim()) return ''
    const m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (!m) return null
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const parsed = new Date(iso + 'T00:00:00Z')
    if (isNaN(parsed.getTime()) || parsed.getUTCMonth() + 1 !== mo || parsed.getUTCDate() !== d) return null
    return iso
}

interface DateInputProps {
    value: string
    onChange: (iso: string) => void
    className?: string
    placeholder?: string
}

export default function DateInput({ value, onChange, className, placeholder = 'DD-MM-YYYY' }: DateInputProps) {
    const [text, setText] = useState(isoToDMY(value))

    useEffect(() => {
        const current = dmyToISO(text)
        if (current !== value) setText(isoToDMY(value))
    }, [value])

    const handle = (raw: string) => {
        setText(raw)
        const iso = dmyToISO(raw)
        if (iso !== null) onChange(iso)
    }

    const invalid = text !== '' && dmyToISO(text) === null

    return (
        <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            placeholder={placeholder}
            value={text}
            className={className}
            onChange={e => handle(e.target.value)}
            aria-invalid={invalid}
            style={invalid ? { borderColor: '#e74c3c' } : undefined}
        />
    )
}
