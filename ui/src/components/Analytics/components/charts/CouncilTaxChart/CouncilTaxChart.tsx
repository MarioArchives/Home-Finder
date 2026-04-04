import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import ChartCard from '../../ChartCard/ChartCard'
import { COLORS } from '../../../constants'
import type { CouncilTaxChartProps } from './properties'

const renderLabel = ({ name, percent }: { name: string; percent: number }) =>
  `${name} ${(percent * 100).toFixed(0)}%`

export default function CouncilTaxChart({ data, onDrillDown }: CouncilTaxChartProps) {
  return (
    <ChartCard title="Council Tax Bands">
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
              if (onDrillDown) {
                const match = data.name.match(/([A-H])/i)
                if (match) onDrillDown({ councilTax: match[1].toUpperCase() })
              }
            }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
