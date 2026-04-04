import { useMemo, useState, memo } from 'react'
import { parsePrice } from '../../shared/utils/utils'
import StatCard from './components/StatCard/StatCard'
import PriceDistribution from './components/charts/PriceDistribution/PriceDistribution'
import PriceByBedrooms from './components/charts/PriceByBedrooms/PriceByBedrooms'
import PriceScatter from './components/charts/PriceScatter/PriceScatter'
import SizeVsPrice from './components/charts/SizeVsPrice/SizeVsPrice'
import CouncilTaxChart from './components/charts/CouncilTaxChart/CouncilTaxChart'
import EpcRatings from './components/charts/EpcRatings/EpcRatings'
import PropertyTypes from './components/charts/PropertyTypes/PropertyTypes'
import FurnishingChart from './components/charts/FurnishingChart/FurnishingChart'
import PriceByPostcode from './components/charts/PriceByPostcode/PriceByPostcode'
import PriceByCouncilTax from './components/charts/PriceByCouncilTax/PriceByCouncilTax'
import PriceHeatmap from './components/charts/PriceHeatmap/PriceHeatmap'
import AvailabilityTimeline from './components/charts/AvailabilityTimeline/AvailabilityTimeline'
import PriceLocationHeatmap from './components/charts/PriceLocationHeatmap/PriceLocationHeatmap'
import type { AnalyticsProps } from './properties'
import type { Listing } from '../../types/listing' // used by scatterData
import './Analytics.css'

function extractPostcode(addr: string): string {
  if (!addr) return 'Unknown'
  const m = addr.match(/([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d?/i)
  return m ? m[1].toUpperCase() : 'Unknown'
}

const CHART_OPTIONS = {
  priceDistribution: 'Price Distribution',
  priceByBedrooms: 'Avg Price by Bedrooms',
  priceScatter: 'Price vs Bedrooms',
  sizeVsPrice: 'Size vs Price',
  councilTax: 'Council Tax Bands',
  epcRatings: 'EPC Ratings',
  propertyTypes: 'Property Types',
  furnishing: 'Furnishing Breakdown',
  priceByPostcode: 'Price by Postcode',
  priceByCouncilTax: 'Price by Council Tax',
  heatmap: 'Price Heatmap',
  priceLocationHeatmap: 'Price Map Heatmap',
  availability: 'Availability Timeline',
} as const

type ChartKey = keyof typeof CHART_OPTIONS
const ALL_CHART_KEYS = Object.keys(CHART_OPTIONS) as ChartKey[]

function Analytics({ listings, nearbyCounts = {}, onDrillDown, onSelectListing }: AnalyticsProps) {
  const [visibleCharts, setVisibleCharts] = useState<Set<ChartKey>>(new Set<ChartKey>([
    'priceDistribution',
    'priceScatter',
    'sizeVsPrice',
    'councilTax',
    'propertyTypes',
    'priceByCouncilTax',
    'priceLocationHeatmap',
    'availability',
  ]))

  const toggleChart = (key: ChartKey) => {
    setVisibleCharts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    if (visibleCharts.size === ALL_CHART_KEYS.length) setVisibleCharts(new Set())
    else setVisibleCharts(new Set(ALL_CHART_KEYS))
  }

  // --- Data computations ---

  const stats = useMemo(() => {
    const prices = listings.map(l => parsePrice(l.price)).filter((p): p is number => p !== null).sort((a, b) => a - b)
    const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0
    const withCoords = listings.filter(l => l.latitude && l.longitude).length
    const sources = [...new Set(listings.map(l => l.source))]
    return { prices, avg, median, min: prices[0] || 0, max: prices[prices.length - 1] || 0, withCoords, sources }
  }, [listings])

  const priceHistData = useMemo(() => {
    const bucketSize = 100
    const buckets: Record<number, number> = {}
    stats.prices.forEach(p => {
      const bucket = Math.floor(p / bucketSize) * bucketSize
      buckets[bucket] = (buckets[bucket] || 0) + 1
    })
    return Object.entries(buckets)
      .map(([k, v]) => ({ range: `£${Number(k).toLocaleString()}`, price: Number(k), count: v }))
      .sort((a, b) => a.price - b.price)
  }, [stats.prices])

  const priceBedData = useMemo(() => {
    const groups: Record<number, number[]> = {}
    listings.forEach(l => {
      const beds = l.bedrooms
      const price = parsePrice(l.price)
      if (beds == null || !price) return
      if (!groups[beds]) groups[beds] = []
      groups[beds].push(price)
    })
    return Object.entries(groups)
      .map(([beds, prices]) => {
        prices.sort((a, b) => a - b)
        return {
          beds: `${beds} bed`, bedsNum: Number(beds),
          avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          median: prices[Math.floor(prices.length / 2)],
          min: prices[0], max: prices[prices.length - 1],
          q1: prices[Math.floor(prices.length * 0.25)],
          q3: prices[Math.floor(prices.length * 0.75)],
          count: prices.length,
        }
      })
      .sort((a, b) => a.bedsNum - b.bedsNum)
  }, [listings])

  const councilTaxData = useMemo(() => {
    const counts: Record<string, number> = {}
    listings.forEach(l => { counts[l.council_tax || 'Unknown'] = (counts[l.council_tax || 'Unknown'] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name))
  }, [listings])

  const epcData = useMemo(() => {
    const counts: Record<string, number> = {}
    listings.forEach(l => { counts[l.epc_rating || 'Unknown'] = (counts[l.epc_rating || 'Unknown'] || 0) + 1 })
    return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Unknown'].filter(k => counts[k]).map(k => ({ rating: k, count: counts[k] }))
  }, [listings])

  const propTypeData = useMemo(() => {
    const counts: Record<string, number> = {}
    listings.forEach(l => { counts[l.property_type || 'Unknown'] = (counts[l.property_type || 'Unknown'] || 0) + 1 })
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [listings])

  const furnishData = useMemo(() => {
    const counts: Record<string, number> = {}
    listings.forEach(l => { counts[l.furnish_type || 'Unknown'] = (counts[l.furnish_type || 'Unknown'] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [listings])

  const priceByAreaData = useMemo(() => {
    const areas: Record<string, number[]> = {}
    listings.forEach(l => {
      const pc = extractPostcode(l.address)
      const price = parsePrice(l.price)
      if (price && pc !== 'Unknown') { if (!areas[pc]) areas[pc] = []; areas[pc].push(price) }
    })
    return Object.entries(areas)
      .filter(([, v]) => v.length >= 3)
      .map(([area, prices]) => {
        prices.sort((a, b) => a - b)
        return { area, avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length), median: prices[Math.floor(prices.length / 2)], min: prices[0], max: prices[prices.length - 1], count: prices.length }
      })
      .sort((a, b) => b.median - a.median).slice(0, 20)
  }, [listings])

  const heatmapData = useMemo(() => {
    const matrix: Record<string, number[]> = {}
    listings.forEach(l => {
      const beds = l.bedrooms; const type = l.property_type || 'Unknown'; const price = parsePrice(l.price)
      if (beds == null || !price) return
      const key = `${beds}|${type}`; if (!matrix[key]) matrix[key] = []; matrix[key].push(price)
    })
    return Object.entries(matrix).map(([key, prices]) => {
      const [beds, type] = key.split('|')
      return { beds: `${beds} bed`, type, avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length), count: prices.length }
    })
  }, [listings])

  const scatterData = useMemo(() => {
    return listings.filter(l => l.bedrooms != null && parsePrice(l.price))
      .map(l => ({ beds: l.bedrooms!, price: parsePrice(l.price)!, listing: l, baths: l.bathrooms || 1, address: l.address, source: l.source }))
  }, [listings])

  const scatterBySource = useMemo(() => {
    const sources = [...new Set(scatterData.map(d => d.source))]
    return sources.map(src => ({ name: src, data: scatterData.filter(d => d.source === src) }))
  }, [scatterData])

  const priceByCouncilTaxData = useMemo(() => {
    const groups: Record<string, number[]> = {}
    listings.forEach(l => {
      const band = l.council_tax; const price = parsePrice(l.price)
      if (!band || !price) return; if (!groups[band]) groups[band] = []; groups[band].push(price)
    })
    return Object.entries(groups)
      .map(([band, prices]) => ({ band, avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length), count: prices.length }))
      .sort((a, b) => a.band.localeCompare(b.band))
  }, [listings])

  const sizeVsPriceData = useMemo(() => {
    return listings
      .filter(l => { if (!l.size_sq_ft || !parsePrice(l.price)) return false; const m = l.size_sq_ft.replace(/,/g, '').match(/(\d+)/); return m && parseInt(m[1], 10) > 0 })
      .map(l => {
        const sqft = parseInt(l.size_sq_ft!.replace(/,/g, '').match(/(\d+)/)![1], 10); const price = parsePrice(l.price)!
        return { sqft, price, beds: l.bedrooms || 0, address: l.address, source: l.source, pricePerSqft: Math.round(price / sqft * 100) / 100, listing: l }
      })
  }, [listings])

  const sizeVsPriceBySource = useMemo(() => {
    const sources = [...new Set(sizeVsPriceData.map(d => d.source))]
    return sources.map(src => ({ name: src, data: sizeVsPriceData.filter(d => d.source === src) }))
  }, [sizeVsPriceData])

  const sizeVsPriceFitLine = useMemo(() => {
    if (sizeVsPriceData.length < 4) return []
    // Remove outliers using IQR on £/sqft before fitting
    const ppsfs = sizeVsPriceData.map(d => d.pricePerSqft).sort((a, b) => a - b)
    const q1 = ppsfs[Math.floor(ppsfs.length * 0.25)]
    const q3 = ppsfs[Math.floor(ppsfs.length * 0.75)]
    const iqr = q3 - q1
    const lo = q1 - 1.5 * iqr
    const hi = q3 + 1.5 * iqr
    const clean = sizeVsPriceData.filter(d => d.pricePerSqft >= lo && d.pricePerSqft <= hi)
    if (clean.length < 2) return []
    const n = clean.length
    const sumX = clean.reduce((s, d) => s + d.sqft, 0)
    const sumY = clean.reduce((s, d) => s + d.price, 0)
    const sumXY = clean.reduce((s, d) => s + d.sqft * d.price, 0)
    const sumXX = clean.reduce((s, d) => s + d.sqft * d.sqft, 0)
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n
    const minX = Math.min(...sizeVsPriceData.map(d => d.sqft))
    const maxX = Math.max(...sizeVsPriceData.map(d => d.sqft))
    const line = []
    for (let i = 0; i <= 20; i++) { const x = minX + (maxX - minX) * (i / 20); line.push({ sqft: Math.round(x), price: Math.round(slope * x + intercept) }) }
    return line
  }, [sizeVsPriceData])

  const availabilityData = useMemo(() => {
    const months: Record<string, number> = {}
    listings.forEach(l => {
      const avail = l.available_from || l.added_on || ''
      const dateMatch = avail.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/)
      if (dateMatch) { const key = `${dateMatch[2]}/${dateMatch[3]}`; months[key] = (months[key] || 0) + 1 }
    })
    return Object.entries(months).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))
  }, [listings])

  const priceLocationData = useMemo(() => {
    return listings
      .filter(l => l.latitude && l.longitude && parsePrice(l.price))
      .map(l => ({ lat: l.latitude!, lng: l.longitude!, price: parsePrice(l.price)!, address: l.address }))
  }, [listings])

  // --- Render ---

  const show = (key: ChartKey) => visibleCharts.has(key)

  return (
    <div className="analytics">
      <div className="analytics-stats-row">
        <StatCard label="Total Listings" value={listings.length} />
        <StatCard label="Avg Price" value={`£${stats.avg.toLocaleString()}`} />
        <StatCard label="Median Price" value={`£${stats.median.toLocaleString()}`} />
        <StatCard label="Price Range" value={`£${stats.min.toLocaleString()} – £${stats.max.toLocaleString()}`} />
        <StatCard label="With Location" value={stats.withCoords} />
        <StatCard label="Sources" value={stats.sources.join(', ')} />
      </div>

      <div className="analytics-layout">
        <aside className="chart-sidebar">
          <div className="chart-sidebar-header">
            <h4>Charts</h4>
            <button className="chart-sidebar-toggle-all" onClick={toggleAll}>
              {visibleCharts.size === ALL_CHART_KEYS.length ? 'Hide all' : 'Show all'}
            </button>
          </div>
          <div className="chart-sidebar-list">
            {ALL_CHART_KEYS.map(key => (
              <label key={key} className={`chart-sidebar-item ${visibleCharts.has(key) ? 'active' : ''}`}>
                <input type="checkbox" checked={visibleCharts.has(key)} onChange={() => toggleChart(key)} />
                <span className="chart-sidebar-item-label">{CHART_OPTIONS[key]}</span>
              </label>
            ))}
          </div>
          <div className="chart-sidebar-count">
            {visibleCharts.size} of {ALL_CHART_KEYS.length} visible
          </div>
        </aside>

        <div className="analytics-grid">
          {show('priceDistribution') && <PriceDistribution data={priceHistData} onDrillDown={onDrillDown} />}
          {show('priceByBedrooms') && <PriceByBedrooms data={priceBedData} onDrillDown={onDrillDown} />}
          {show('priceScatter') && <PriceScatter scatterBySource={scatterBySource} onSelectListing={onSelectListing} onDrillDown={onDrillDown} />}
          {show('sizeVsPrice') && sizeVsPriceData.length > 0 && (
            <SizeVsPrice sizeVsPriceBySource={sizeVsPriceBySource} fitLine={sizeVsPriceFitLine} dataCount={sizeVsPriceData.length} onSelectListing={onSelectListing} onDrillDown={onDrillDown} />
          )}
          {show('councilTax') && <CouncilTaxChart data={councilTaxData} onDrillDown={onDrillDown} />}
          {show('epcRatings') && <EpcRatings data={epcData} onDrillDown={onDrillDown} />}
          {show('propertyTypes') && <PropertyTypes data={propTypeData} onDrillDown={onDrillDown} />}
          {show('furnishing') && <FurnishingChart data={furnishData} onDrillDown={onDrillDown} />}
          {show('priceByPostcode') && <PriceByPostcode data={priceByAreaData} onDrillDown={onDrillDown} />}
          {show('priceByCouncilTax') && <PriceByCouncilTax data={priceByCouncilTaxData} onDrillDown={onDrillDown} />}
          {show('heatmap') && <PriceHeatmap data={heatmapData} onDrillDown={onDrillDown} />}
          {show('priceLocationHeatmap') && <PriceLocationHeatmap data={priceLocationData} onDrillDown={onDrillDown} />}
          {show('availability') && availabilityData.length > 0 && <AvailabilityTimeline data={availabilityData} onDrillDown={onDrillDown} />}
        </div>
      </div>
    </div>
  )
}

export default memo(Analytics)
