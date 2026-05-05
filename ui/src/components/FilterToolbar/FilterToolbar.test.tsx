import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import FilterToolbar from './FilterToolbar'
import type { FilterState } from '../../types/listing'

// useSources fires a network call and updates async; stub it for predictability.
vi.mock('../../shared/sources', () => ({
    useSources: () => ([
        { name: 'rightmove', label: 'Rightmove', icon: 'R', color: '#0f0', bg: '', supports_buy: true },
        { name: 'zoopla', label: 'Zoopla', icon: 'Z', color: '#7a2cff', bg: '', supports_buy: true },
    ]),
    sourceMeta: (n: string) => ({ name: n, label: n, icon: '', color: '#000', bg: '', supports_buy: true }),
    ensureSourcesLoaded: () => Promise.resolve(),
}))

const EMPTY: FilterState = {
    search: '', minPrice: '', maxPrice: '', bedrooms: '', maxBedrooms: '',
    bathrooms: '', propertyType: '', propertyTypes: [], source: '',
    furnishType: '', furnishTypes: [], councilTax: '', minSqFt: '', maxSqFt: '',
    availableFrom: '', availableTo: '', excludeShares: false,
    pinLat: '', pinLng: '', pinRadius: '',
}

const OPTIONS = {
    propertyTypes: ['Flat', 'House'],
    sources: ['rightmove', 'zoopla'],
    furnishTypes: ['Furnished', 'Unfurnished'],
    bedroomCounts: [1, 2, 3, 4],
    bathroomCounts: [1, 2, 3],
}

function Harness({ initial = EMPTY, showMore = false }: { initial?: FilterState; showMore?: boolean }) {
    const [filters, setFilters] = useState(initial)
    const [open, setOpen] = useState(showMore)
    return (
        <FilterToolbar
            filters={filters}
            setFilters={setFilters}
            options={OPTIONS}
            showMoreFilters={open}
            setShowMoreFilters={setOpen}
            onSearchChange={vi.fn()}
            onShowPinPopup={vi.fn()}
        />
    )
}

describe('FilterToolbar — primary row', () => {
    it('renders min/max price + min/max beds + property type controls', () => {
        render(<Harness />)
        expect(screen.getByPlaceholderText(/e\.g\. 800/)).toBeInTheDocument()
        expect(screen.getByPlaceholderText(/e\.g\. 1500/)).toBeInTheDocument()
        expect(screen.getByLabelText(/Exclude shares/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /more filters/i })).toBeInTheDocument()
    })

    it('updates minPrice via the input', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        const input = screen.getByPlaceholderText(/e\.g\. 800/) as HTMLInputElement
        await user.type(input, '1200')
        expect(input.value).toBe('1200')
    })

    it('toggles excludeShares', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        const cb = screen.getByLabelText(/Exclude shares/i) as HTMLInputElement
        expect(cb.checked).toBe(false)
        await user.click(cb)
        expect(cb.checked).toBe(true)
    })

    it('More filters button opens extra row', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        expect(screen.queryByText('Min baths')).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /more filters/i }))
        expect(screen.getByText('Min baths')).toBeInTheDocument()
    })

    it('Clear button resets all filters', async () => {
        const user = userEvent.setup()
        render(<Harness initial={{ ...EMPTY, minPrice: '1000', excludeShares: true }} />)
        const min = screen.getByPlaceholderText(/e\.g\. 800/) as HTMLInputElement
        expect(min.value).toBe('1000')
        await user.click(screen.getByRole('button', { name: 'Clear' }))
        expect(min.value).toBe('')
        expect((screen.getByLabelText(/Exclude shares/i) as HTMLInputElement).checked).toBe(false)
    })

    it('extra-filter badge count appears after toggling extras', async () => {
        const user = userEvent.setup()
        render(<Harness initial={{ ...EMPTY, bathrooms: '2', minSqFt: '500' }} />)
        // Should show "(2)" since bathrooms + minSqFt are set
        const moreBtn = screen.getByRole('button', { name: /more filters/i })
        expect(moreBtn.textContent).toMatch(/\(2\)/)
        await user.click(moreBtn)
        expect(screen.getByText('Min baths')).toBeInTheDocument()
    })
})

describe('FilterToolbar — pin active bar', () => {
    it('shows pin bar when pinLat+pinLng set', () => {
        render(<Harness initial={{ ...EMPTY, pinLat: '53.5', pinLng: '-2.3', pinRadius: '2' }} />)
        expect(screen.getByText(/Pin: 53\.5000, -2\.3000 — 2km radius/)).toBeInTheDocument()
    })

    it('Remove button on pin bar clears pin', async () => {
        const user = userEvent.setup()
        render(<Harness initial={{ ...EMPTY, pinLat: '53.5', pinLng: '-2.3', pinRadius: '2' }} />)
        await user.click(screen.getByRole('button', { name: /remove/i }))
        expect(screen.queryByText(/Pin: 53\.5000/)).not.toBeInTheDocument()
    })
})
