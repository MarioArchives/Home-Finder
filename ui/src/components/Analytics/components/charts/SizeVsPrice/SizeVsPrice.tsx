import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import ChartCard from '../../ChartCard/ChartCard';
import { COLORS } from '../../../constants';
import type { SizeVsPriceProps } from './properties';

export default function SizeVsPrice({
  sizeVsPriceBySource,
  fitLine,
  dataCount,
  onSelectListing,
  onDrillDown,
}: SizeVsPriceProps) {
  return (
    <ChartCard title={`Size (sq ft) vs Price (${dataCount} listings with area data)`} wide>
      <ResponsiveContainer width="100%" height={450}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis
            type="number"
            dataKey="sqft"
            name="Sq ft"
            tick={{ fill: '#8b8fa3', fontSize: 11 }}
            label={{ value: 'Sq ft', position: 'insideBottom', offset: -5, fill: '#8b8fa3' }}
          />
          <YAxis
            type="number"
            dataKey="price"
            name="Price"
            tick={{ fill: '#8b8fa3', fontSize: 11 }}
            label={{ value: 'Price', angle: -90, position: 'insideLeft', fill: '#8b8fa3' }}
          />
          <ZAxis type="number" dataKey="beds" range={[40, 200]} name="Bedrooms" />
          <Tooltip
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div className="analytics-tooltip">
                  <div>£{d.price.toLocaleString()} pcm</div>
                  <div>{d.sqft} sq ft · {d.beds} bed</div>
                  <div>£{d.pricePerSqft.toFixed(2)}/sq ft</div>
                  <div className="analytics-tooltip-secondary">{d.address}</div>
                </div>
              );
            }}
          />
          {sizeVsPriceBySource.map((group, i) => (
            <Scatter
              key={group.name}
              name={group.name}
              data={group.data}
              fill={COLORS[i % COLORS.length]}
              opacity={0.7}
              cursor="pointer"
              onClick={(data: any) => {
                onSelectListing(data.listing)
                if (onDrillDown) onDrillDown({ minSqFt: String(data.sqft - 50), maxSqFt: String(data.sqft + 50) })
              }}
            />
          ))}
          <Scatter
            name="Best fit"
            data={fitLine}
            fill="none"
            line={{ stroke: '#f472b6', strokeWidth: 2, strokeDasharray: '6 3' }}
            legendType="line"
            shape={() => null}
          />
          <Legend verticalAlign="top" />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
