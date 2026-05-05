import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

/**
 * Mounts the App shell at a specific route. Tests for view-level behavior
 * use this so they remain valid after the refactor that splits routes into
 * dedicated <View/> components — only this helper changes.
 */
export function renderAtRoute(route: string) {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <App />
        </MemoryRouter>
    )
}
