import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import ChartCard from '../../ChartCard/ChartCard';
import type { PriceByPostcodeProps } from './properties';

export default function PriceByPostcode({ data, onDrillDown }: PriceByPostcodeProps) {
  return (
    <ChartCard title="Median Price by Postcode (3+ listings)" wide>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart layout="vertical" data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis type="number" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="area"
            width={50}
            tick={{ fill: '#8b8fa3', fontSize: 11 }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div className="analytics-tooltip">
                  <div><strong>{d.area}</strong></div>
                  <div>Median: £{d.median.toLocaleString()}</div>
                  <div>Avg: £{d.avg.toLocaleString()}</div>
                  <div>Range: £{d.min.toLocaleString()} – £{d.max.toLocaleString()}</div>
                  <div className="analytics-tooltip-secondary">{d.count} listings</div>
                </div>
              );
            }}
          />
          <Bar dataKey="median" fill="#7c5cfc" name="Median" cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ search: data.area }) }} />
          <Bar dataKey="avg" fill="#c084fc" opacity={0.5} name="Average" cursor="pointer" onClick={(data: any) => { if (onDrillDown) onDrillDown({ search: data.area }) }} />
          <Legend />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
