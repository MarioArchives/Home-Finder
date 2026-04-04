import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import CustomTooltip from '../../CustomTooltip/CustomTooltip'
import { EPC_COLORS } from '../../../constants'
import type { EpcRatingsProps } from './properties'

export default function EpcRatings({ data, onDrillDown }: EpcRatingsProps) {
  return (
    <ChartCard title="EPC Ratings">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis dataKey="rating" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="count"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data: any) => {
              if (onDrillDown) onDrillDown({ search: data.rating !== 'Unknown' ? 'EPC ' + data.rating : '' })
            }}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={EPC_COLORS[entry.rating] || '#7c5cfc'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
