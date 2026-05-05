import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import CustomTooltip from '../../CustomTooltip/CustomTooltip'
import type { PriceByBedroomsProps } from './properties'

export default function PriceByBedrooms({ data, onDrillDown }: PriceByBedroomsProps) {
  const formatter = (v: number) => `£${v.toLocaleString()}`

  return (
    <ChartCard title="Avg Price by Bedrooms">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis dataKey="beds" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip formatter={formatter} />} />
          <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 8 }} />
          <Bar dataKey="min" stackId="range" fill="#f87171" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ bedrooms: String(data.bedsNum) }) }} />
          <Bar dataKey="q1" stackId="a" fill="#fbbf24" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ bedrooms: String(data.bedsNum) }) }} />
          <Bar dataKey="median" fill="#34d399" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ bedrooms: String(data.bedsNum) }) }} />
          <Bar dataKey="avg" fill="#7c5cfc" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ bedrooms: String(data.bedsNum) }) }} />
          <Bar dataKey="max" fill="#38bdf8" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ bedrooms: String(data.bedsNum) }) }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
