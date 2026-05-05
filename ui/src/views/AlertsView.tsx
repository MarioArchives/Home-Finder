import { Suspense, lazy } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useAppStatus } from '../contexts/DataContext'
import type { OutletData } from './AppShell'

const Alerts = lazy(() => import('../components/Alerts/Alerts'))
const TelegramSetup = lazy(() => import('../components/TelegramSetup/TelegramSetup'))

const AlertsView = () => {
    const { options } = useOutletContext<OutletData>()
    const { telegramConfigured, setTelegramConfigured } = useAppStatus()

    return (
        <Suspense fallback={<div className="no-results">Loading...</div>}>
            {telegramConfigured ? (
                <Alerts
                    propertyTypes={options.propertyTypes}
                    furnishTypes={options.furnishTypes}
                    bedroomCounts={options.bedroomCounts}
                    bathroomCounts={options.bathroomCounts}
                />
            ) : (
                <TelegramSetup onComplete={() => setTelegramConfigured(true)} />
            )}
        </Suspense>
    )
}

export default AlertsView
