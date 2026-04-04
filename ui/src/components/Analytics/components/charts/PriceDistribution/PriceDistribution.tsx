import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import CustomTooltip from '../../CustomTooltip/CustomTooltip'
import type { PriceDistributionProps } from './properties'

export default function PriceDistribution({ data, onDrillDown }: PriceDistributionProps) {
  return (
    <ChartCard title="Price Distribution">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis dataKey="range" angle={-45} textAnchor="end" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="count"
            fill="#7c5cfc"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data: any) => {
              if (onDrillDown) onDrillDown({ minPrice: String(data.price), maxPrice: String(data.price + 99) })
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
