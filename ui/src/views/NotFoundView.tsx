import { NavLink } from 'react-router-dom'

const NotFoundView = () => (
    <div className="not-found">
        <h2>404</h2>
        <p>Page not found</p>
        <NavLink to="/" className="not-found-link">Back to listings</NavLink>
    </div>
)

export default NotFoundView
