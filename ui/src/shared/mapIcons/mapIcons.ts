import L from 'leaflet'
import './mapIcons.css'

// Fix default marker icons (Leaflet + bundlers issue)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const AMENITY_EMOJIS: Record<string, string> = {
  bars: '\u{1F37A}',
  cafes: '\u2615',
  shops: '\u{1F6D2}',
  climbing: '\u{1F9D7}',
}

export function amenityIcon(category: string): L.DivIcon {
  const emoji = AMENITY_EMOJIS[category] || '\u{1F4CD}'
  return L.divIcon({
    className: 'emoji-marker',
    html: `<span class="emoji-marker-icon">${emoji}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

export const propertyIcon = L.divIcon({
  className: 'emoji-marker',
  html: `<span class="emoji-marker-icon emoji-marker-icon--property">\u{1F3E0}</span>`,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
})

// Dot-style icons for Analytics popup maps
const DOT_CLASSES: Record<string, string> = {
  bars: 'dot-marker-icon--bars',
  cafes: 'dot-marker-icon--cafes',
  shops: 'dot-marker-icon--shops',
}

export function amenityDotIcon(category: string): L.DivIcon {
  const colorClass = DOT_CLASSES[category] || 'dot-marker-icon--default'
  return L.divIcon({
    className: 'amenity-marker',
    html: `<div class="dot-marker-icon ${colorClass}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

export const propertyDotIcon = L.divIcon({
  className: 'property-marker',
  html: `<div class="dot-marker-icon--property"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})
