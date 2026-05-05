import { render, type RenderOptions } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { type ReactElement, type ReactNode } from 'react'

interface Options extends Omit<RenderOptions, 'wrapper'> {
    route?: string
}

export function renderWithRouter(ui: ReactElement, opts: Options = {}) {
    const { route = '/', ...rest } = opts
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    )
    return render(ui, { wrapper: Wrapper, ...rest })
}
