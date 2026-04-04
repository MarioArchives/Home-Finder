import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import { COLORS } from '../../../constants'
import type { FurnishingChartProps } from './properties'

const renderLabel = ({ name, percent }: { name: string; percent: number }) =>
  `${name} ${(percent * 100).toFixed(0)}%`

export default function FurnishingChart({ data, onDrillDown }: FurnishingChartProps) {
  return (
    <ChartCard title="Furnishing Breakdown">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={60}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            label={renderLabel}
            cursor="pointer"
            onClick={(data: any) => {
              if (onDrillDown) onDrillDown({ furnishType: data.name !== 'Unknown' ? data.name : '' })
            }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
