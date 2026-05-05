import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import ChartCard from '../../ChartCard/ChartCard'
import type { PriceLocationHeatmapProps } from './properties'
import './PriceLocationHeatmap.css'

/** Gaussian bandwidth in metres — controls how far each property's influence spreads */
const SIGMA = 800
/** Cell size in pixels — large for visible blocky squares */
const CELL_SIZE = 28
/** Overlay opacity for the hottest cells */
const MAX_OPACITY = 0.6
/** Gap between cells in pixels for the grid look */
const CELL_GAP = 2
/** Cutoff: ignore properties further than this */
const MAX_DIST = SIGMA * 3.5

interface PropertyPoint {
  lat: number
  lng: number
  price: number
}

function lerpColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  // Blue (cold/far) -> Cyan -> Green -> Yellow -> Red (hot/near)
  const stops: [number, number, number, number][] = [
    [0,     30,  60, 180],   // dark blue
    [0.2,   40, 140, 210],   // cyan-blue
    [0.4,   50, 190, 100],   // green
    [0.6,  180, 210,  50],   // yellow-green
    [0.8,  250, 170,  30],   // orange
    [1,    220,  30,  30],   // red
  ]

  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const s = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0])
  return [
    Math.round(lo[1] + s * (hi[1] - lo[1])),
    Math.round(lo[2] + s * (hi[2] - lo[2])),
    Math.round(lo[3] + s * (hi[3] - lo[3])),
  ]
}

function buildLegendGradient(): string {
  const stops: string[] = []
  for (let i = 0; i <= 10; i++) {
    const [r, g, b] = lerpColor(i / 10)
    stops.push(`rgb(${r},${g},${b})`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

/** Haversine distance in metres */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function HeatmapCanvas({ points, sigma }: { points: PropertyPoint[]; sigma: number }) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const render = useCallback(() => {
    const container = map.getContainer()
    const maxDist = sigma * 3.5

    let canvas = canvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '450'
      const overlayPane = container.querySelector('.leaflet-overlay-pane')
      if (overlayPane) {
        overlayPane.appendChild(canvas)
      } else {
        container.appendChild(canvas)
      }
      canvasRef.current = canvas
    }

    const size = map.getSize()
    canvas.width = size.x
    canvas.height = size.y
    canvas.style.width = size.x + 'px'
    canvas.style.height = size.y + 'px'

    // Position canvas at the layer-point of the container's top-left corner
    const topLeftLatLng = map.containerPointToLatLng([0, 0])
    const topLeftLayer = map.latLngToLayerPoint(topLeftLatLng)
    canvas.style.left = topLeftLayer.x + 'px'
    canvas.style.top = topLeftLayer.y + 'px'
    canvas.style.transform = ''

    const ctx = canvas.getContext('2d')
    if (!ctx || points.length === 0) {
      if (ctx) ctx.clearRect(0, 0, size.x, size.y)
      return
    }

    ctx.clearRect(0, 0, size.x, size.y)

    const cols = Math.ceil(size.x / CELL_SIZE)
    const rows = Math.ceil(size.y / CELL_SIZE)
    const gaussDenom = -1 / (2 * sigma * sigma)

    // --- Pass 1: compute raw heat values for each cell ---
    const heatValues: number[] = new Array(cols * rows)
    let maxHeat = 0

    for (let row = 0; row < rows; row++) {
      const cy = row * CELL_SIZE + CELL_SIZE / 2
      for (let col = 0; col < cols; col++) {
        const cx = col * CELL_SIZE + CELL_SIZE / 2
        const cellLatLng = map.containerPointToLatLng([cx, cy])

        let heat = 0
        for (const pp of points) {
          const dist = haversine(cellLatLng.lat, cellLatLng.lng, pp.lat, pp.lng)
          if (dist > maxDist) continue
          heat += pp.price * Math.exp(dist * dist * gaussDenom)
        }

        const idx = row * cols + col
        heatValues[idx] = heat
        if (heat > maxHeat) maxHeat = heat
      }
    }

    if (maxHeat === 0) return

    // --- Pass 2: render cells with colors mapped from heat ---
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const heat = heatValues[row * cols + col]
        if (heat === 0) continue

        const t = Math.sqrt(heat / maxHeat)
        const [r, g, b] = lerpColor(t)
        const alpha = MAX_OPACITY * t

        if (alpha < 0.02) continue

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
        ctx.fillRect(
          col * CELL_SIZE + CELL_GAP / 2,
          row * CELL_SIZE + CELL_GAP / 2,
          CELL_SIZE - CELL_GAP,
          CELL_SIZE - CELL_GAP,
        )
      }
    }
  }, [map, points, sigma])

  useEffect(() => {
    const timer = setTimeout(render, 150)
    map.on('moveend', render)
    map.on('zoomend', render)
    map.on('resize', render)
    return () => {
      clearTimeout(timer)
      map.off('moveend', render)
      map.off('zoomend', render)
      map.off('resize', render)
      if (canvasRef.current) {
        canvasRef.current.remove()
        canvasRef.current = null
      }
    }
  }, [map, render])

  return null
}

function FitBounds({ data }: { data: PropertyPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (data.length > 0) {
      const bounds = data.map(d => [d.lat, d.lng] as [number, number])
      map.fitBounds(bounds, { padding: [30, 30] })
    }
  }, [data, map])
  return null
}

export default function PriceLocationHeatmap({ data }: PriceLocationHeatmapProps) {
  // All hooks must run on every render — keep them above the empty-data
  // early return below so React's hook ordering stays consistent. Calling
  // hooks conditionally crashes the whole Analytics tree with "Rendered
  // fewer hooks than expected".
  const [sigma, setSigma] = useState(SIGMA)
  const points: PropertyPoint[] = useMemo(
    () => data.map(d => ({ lat: d.lat, lng: d.lng, price: d.price })),
    [data],
  )

  if (data.length === 0) return (
    <ChartCard title="Price Heatmap by Location" wide>
      <p className="heatmap-no-data">No exact location shared for the selected properties.</p>
    </ChartCard>
  )

  const maxPrice = Math.max(...data.map(d => d.price))

  const center: [number, number] = [
    data.reduce((s, d) => s + d.lat, 0) / data.length,
    data.reduce((s, d) => s + d.lng, 0) / data.length,
  ]

  return (
    <ChartCard title="Price Heatmap by Location" wide>
      <div className="heatmap-controls">
        <label className="heatmap-slider-label">
          Spread: {sigma >= 1000 ? `${(sigma / 1000).toFixed(1)}km` : `${sigma}m`}
          <input
            type="range"
            min={200}
            max={3000}
            step={100}
            value={sigma}
            onChange={e => setSigma(Number(e.target.value))}
            className="heatmap-slider"
          />
        </label>
      </div>
      <MapContainer center={center} zoom={13} className="price-heatmap-container">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds data={points} />
        <HeatmapCanvas points={points} sigma={sigma} />
      </MapContainer>
      <div className="price-heatmap-legend">
        <span>Low</span>
        <div className="price-heatmap-gradient" style={{ background: buildLegendGradient() }} />
        <span>High (&pound;{maxPrice.toLocaleString()})</span>
      </div>
    </ChartCard>
  )
}
