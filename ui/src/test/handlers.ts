import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { readyStatus, sampleAmenities, sampleListingsData, sampleSources } from './fixtures'

export const defaultHandlers = [
    http.get('/api/status', () => HttpResponse.json(readyStatus)),
    http.get('/api/sources', () => HttpResponse.json(sampleSources)),
    http.get('/listings.json', () => HttpResponse.json(sampleListingsData)),
    http.get('/amenities.json', () => HttpResponse.json({ properties: sampleAmenities })),
    http.get('/api/cron/status', () => HttpResponse.json({ enabled: false, next_run: null })),
    http.get('/api/alerts', () => HttpResponse.json({ alerts: [] })),
    http.get('/api/telegram/chats', () => HttpResponse.json({ chats: [] })),
    http.get('/api/telegram/status', () => HttpResponse.json({ configured: true })),
]

export const server = setupServer(...defaultHandlers)
