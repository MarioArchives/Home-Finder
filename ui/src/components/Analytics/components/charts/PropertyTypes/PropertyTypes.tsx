import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import CustomTooltip from '../../CustomTooltip/CustomTooltip'
import type { PropertyTypesProps } from './properties'

export default function PropertyTypes({ data, onDrillDown }: PropertyTypesProps) {
  return (
    <ChartCard title="Property Types">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis type="number" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="count"
            fill="#38bdf8"
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(data: any) => {
              if (onDrillDown) onDrillDown({ propertyType: data.name })
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
