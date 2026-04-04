import { useState } from 'react'
import type { FloorplanModalProps } from './properties'
import './FloorplanModal.css'

export default function FloorplanModal({ floorplanUrl, address, onClose }: FloorplanModalProps) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="floorplan-overlay" onClick={onClose}>
      <div className="floorplan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="floorplan-header">
          <h3>Floor Plan &mdash; {address}</h3>
          <button className="floorplan-close" onClick={onClose}>&times;</button>
        </div>
        <div className="floorplan-body">
          {imgError ? (
            <div className="floorplan-error">
              <p>Could not load floor plan image.</p>
              <a href={floorplanUrl} target="_blank" rel="noopener noreferrer">
                Open floor plan in new tab
              </a>
            </div>
          ) : (
            <img
              className="floorplan-image"
              src={floorplanUrl}
              alt={`Floor plan for ${address}`}
              onError={() => setImgError(true)}
            />
          )}
        </div>
        <div className="floorplan-footer">
          <a href={floorplanUrl} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
        </div>
      </div>
    </div>
  )
}
