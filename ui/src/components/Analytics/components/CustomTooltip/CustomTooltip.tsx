import type { CustomTooltipProps } from './properties'
import './CustomTooltip.css'

export default function CustomTooltip({ active, payload, label, formatter }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="analytics-tooltip">
      {label && <div className="analytics-tooltip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.fill }}>
          {p.name}: {formatter ? formatter(p.value) : p.value}
        </div>
      ))}
    </div>
  )
}
