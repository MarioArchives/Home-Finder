import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkPinBar from './WorkPinBar'

const baseProps = {
    workPinLat: '53.5000',
    workPinLng: '-2.3000',
    commuteStatus: 'idle' as const,
    commuteCount: 0,
    onChangePin: vi.fn(),
    onRemovePin: vi.fn(),
}

describe('WorkPinBar', () => {
    it('returns nothing when work pin not set', () => {
        const { container } = render(<WorkPinBar {...baseProps} workPinLat="" workPinLng="" />)
        expect(container.firstChild).toBeNull()
    })

    it('shows formatted lat/lng', () => {
        render(<WorkPinBar {...baseProps} />)
        expect(screen.getByText(/53\.5000/)).toBeInTheDocument()
        expect(screen.getByText(/-2\.3000/)).toBeInTheDocument()
    })

    it('shows fetching commute when loading', () => {
        render(<WorkPinBar {...baseProps} commuteStatus="loading" />)
        expect(screen.getByText(/Fetching commute times/i)).toBeInTheDocument()
    })

    it('shows count when commute done', () => {
        render(<WorkPinBar {...baseProps} commuteStatus="done" commuteCount={42} />)
        expect(screen.getByText(/42 commute times loaded/i)).toBeInTheDocument()
    })

    it('shows error message when commute fails', () => {
        render(<WorkPinBar {...baseProps} commuteStatus="error" />)
        expect(screen.getByText(/Could not fetch commute times/i)).toBeInTheDocument()
    })

    it('Change/Remove buttons fire callbacks', async () => {
        const user = userEvent.setup()
        render(<WorkPinBar {...baseProps} />)
        await user.click(screen.getByRole('button', { name: /change/i }))
        expect(baseProps.onChangePin).toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: /remove/i }))
        expect(baseProps.onRemovePin).toHaveBeenCalled()
    })
})
