import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CustomPinsBar from './CustomPinsBar'
import type { CustomPin } from '../../types/listing'

// PinPickerInner pulls in react-leaflet which jsdom can't render. Stub it
// out — the popup-open path stays exercised but the map stays inert.
vi.mock('../PinPicker/PinPicker', () => ({
    PinPickerInner: () => <div data-testid="pin-picker-inner" />,
    PinPickerPopup: () => null,
}))

function Harness({ initial = [] as CustomPin[] }: { initial?: CustomPin[] }) {
    const [pins, setPins] = useState<CustomPin[]>(initial)
    return <CustomPinsBar customPins={pins} setCustomPins={setPins} />
}

describe('CustomPinsBar', () => {
    it('renders Add pin button when empty', () => {
        render(<Harness />)
        expect(screen.getByRole('button', { name: /\+ Add pin/ })).toBeInTheDocument()
    })

    it('renders chip per pin with emoji and label', () => {
        render(<Harness initial={[
            { id: 'a', label: 'Office', emoji: '🏢', lat: 0, lng: 0 },
            { id: 'b', label: 'Gym', emoji: '🏋️', lat: 0, lng: 0 },
        ]} />)
        expect(screen.getByText('Office')).toBeInTheDocument()
        expect(screen.getByText('Gym')).toBeInTheDocument()
        expect(screen.getByText('🏢')).toBeInTheDocument()
    })

    it('removes a chip when its × is clicked', async () => {
        const user = userEvent.setup()
        render(<Harness initial={[{ id: 'a', label: 'Office', emoji: '🏢', lat: 0, lng: 0 }]} />)
        expect(screen.getByText('Office')).toBeInTheDocument()
        await user.click(screen.getByTitle(/Remove Office/))
        expect(screen.queryByText('Office')).not.toBeInTheDocument()
    })

    it('opens add-pin popup when Add pin is clicked', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        await user.click(screen.getByRole('button', { name: /\+ Add pin/ }))
        expect(screen.getByText(/Add a custom pin/i)).toBeInTheDocument()
        expect(screen.getByTestId('pin-picker-inner')).toBeInTheDocument()
    })
})
