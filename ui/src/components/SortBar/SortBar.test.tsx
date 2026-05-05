import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortBar from './SortBar'

const baseProps = {
    sortBy: 'price-asc',
    setSortBy: vi.fn(),
    resultCount: 25,
    customLat: '',
    setCustomLat: vi.fn(),
    customLng: '',
    setCustomLng: vi.fn(),
    workPinLat: '',
    onSetWorkPin: vi.fn(),
}

describe('SortBar', () => {
    it('renders result count (plural)', () => {
        render(<SortBar {...baseProps} />)
        expect(screen.getByText('25 results')).toBeInTheDocument()
    })

    it('renders result count (singular)', () => {
        render(<SortBar {...baseProps} resultCount={1} />)
        expect(screen.getByText('1 result')).toBeInTheDocument()
    })

    it('select reflects sortBy value', () => {
        render(<SortBar {...baseProps} sortBy="beds-desc" />)
        expect(screen.getByRole('combobox')).toHaveValue('beds-desc')
    })

    it('calls setSortBy on change', async () => {
        const user = userEvent.setup()
        render(<SortBar {...baseProps} />)
        await user.selectOptions(screen.getByRole('combobox'), 'price-desc')
        expect(baseProps.setSortBy).toHaveBeenCalledWith('price-desc')
    })

    it('shows custom-coords inputs only when sortBy is custom-dist-asc', () => {
        const { rerender } = render(<SortBar {...baseProps} />)
        expect(screen.queryByPlaceholderText(/Latitude/)).not.toBeInTheDocument()
        rerender(<SortBar {...baseProps} sortBy="custom-dist-asc" />)
        expect(screen.getByPlaceholderText(/Latitude/)).toBeInTheDocument()
        expect(screen.getByPlaceholderText(/Longitude/)).toBeInTheDocument()
    })

    it('shows commute setup prompt when sortBy=commute-asc and no workPinLat', () => {
        render(<SortBar {...baseProps} sortBy="commute-asc" />)
        expect(screen.getByRole('button', { name: /set work location/i })).toBeInTheDocument()
    })

    it('hides commute prompt when workPinLat is set', () => {
        render(<SortBar {...baseProps} sortBy="commute-asc" workPinLat="53.5" />)
        expect(screen.queryByRole('button', { name: /set work location/i })).not.toBeInTheDocument()
    })

    it('calls onSetWorkPin when prompt button clicked', async () => {
        const user = userEvent.setup()
        render(<SortBar {...baseProps} sortBy="commute-asc" />)
        await user.click(screen.getByRole('button', { name: /set work location/i }))
        expect(baseProps.onSetWorkPin).toHaveBeenCalled()
    })
})
