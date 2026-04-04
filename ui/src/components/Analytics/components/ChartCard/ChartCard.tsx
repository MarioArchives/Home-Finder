import type { ChartCardProps } from './properties'
import './ChartCard.css'

export default function ChartCard({ title, children, wide }: ChartCardProps) {
  return (
    <div className={`analytics-chart-card${wide ? ' wide' : ''}`}>
      <h3>{title}</h3>
      {children}
    </div>
  )
}
