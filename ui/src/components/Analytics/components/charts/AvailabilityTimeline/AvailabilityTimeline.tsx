import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import ChartCard from '../../ChartCard/ChartCard';
import CustomTooltip from '../../CustomTooltip/CustomTooltip';
import type { AvailabilityTimelineProps } from './properties';

export default function AvailabilityTimeline({ data, onDrillDown }: AvailabilityTimelineProps) {
  return (
    <ChartCard title="Listings by Available Date" wide>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart
          data={data}
          onClick={(state: any) => {
            if (state && state.activePayload && state.activePayload.length && onDrillDown) {
              const d = state.activePayload[0].payload
              const [mm, yyyy] = d.month.split('/')
              const lastDay = new Date(Number(yyyy), Number(mm), 0).getDate()
              onDrillDown({
                availableFrom: `${yyyy}-${mm.padStart(2, '0')}-01`,
                availableTo: `${yyyy}-${mm.padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
              })
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis dataKey="month" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#7c5cfc"
            fill="#7c5cfc"
            fillOpacity={0.3}
            cursor="pointer"
            activeDot={{ cursor: 'pointer' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
