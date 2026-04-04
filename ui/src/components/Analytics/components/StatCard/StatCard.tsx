import type { StatCardProps } from './properties'
import './StatCard.css'

export default function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="analytics-stat">
      <div className="analytics-stat-label">{label}</div>
      <div className="analytics-stat-value">{value}</div>
    </div>
  )
}
