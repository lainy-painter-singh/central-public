import { useState } from 'react'
import { differenceInDays } from 'date-fns'
import { DEAL_CATEGORIES } from '../../lib/constants'
import type { Deal } from '../../lib/ipc'

interface DealRowProps {
  deal: Deal
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
  isSelected: boolean
}

export function DealRow({ deal, onDragStart, onDragEnd, onClick, isSelected }: DealRowProps) {
  const [expanded, setExpanded] = useState(false)

  const daysInCategory = deal.moved_at
    ? differenceInDays(new Date(), new Date(deal.moved_at))
    : 0

  const categoryConfig = DEAL_CATEGORIES.find(c => c.id === deal.category)

  const handleClick = (e: React.MouseEvent) => {
    // If clicking the expand button, don't open detail panel
    if ((e.target as HTMLElement).closest('[data-expand]')) return
    onClick()
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      className={`px-4 py-3 cursor-pointer transition-colors ${
        isSelected ? 'bg-accent/5' : 'hover:bg-surface-hover'
      }`}
    >
      {/* Main Row */}
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <span className="text-text-tertiary opacity-0 group-hover:opacity-100 cursor-grab text-xs select-none">
          ⠿
        </span>

        {/* Company Name */}
        <h3 className="text-sm font-medium text-text-primary flex-1 truncate">
          {deal.company_name}
        </h3>

        {/* Contact */}
        {deal.contact_name && (
          <span className="text-xs text-text-tertiary truncate max-w-[120px]">
            {deal.contact_name}
          </span>
        )}

        {/* Source */}
        {deal.source && (
          <span className="text-xs text-text-tertiary truncate max-w-[100px]">
            via {deal.source}
          </span>
        )}

        {/* Days in stage */}
        {daysInCategory > 0 && (
          <span className={`text-xs tabular-nums ${
            daysInCategory > 14 ? 'text-urgent' : daysInCategory > 7 ? 'text-high' : 'text-text-tertiary'
          }`}>
            {daysInCategory}d
          </span>
        )}

        {/* Expand toggle */}
        <button
          data-expand
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
          className="text-text-tertiary hover:text-text-secondary text-xs transition-colors p-1"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-2 ml-6 space-y-1.5">
          {deal.description && (
            <p className="text-xs text-text-secondary leading-relaxed">
              {deal.description}
            </p>
          )}
          <div className="flex items-center gap-4 text-xs text-text-tertiary">
            {deal.revenue && (
              <span>Revenue: <span className="text-text-secondary">{deal.revenue}</span></span>
            )}
            {deal.round_size && (
              <span>Round: <span className="text-text-secondary">{deal.round_size}</span></span>
            )}
            {deal.contact_email && (
              <span>{deal.contact_email}</span>
            )}
          </div>
          {deal.notes && (
            <p className="text-xs text-text-tertiary italic truncate">
              {deal.notes}
            </p>
          )}
          {deal.category === 'passed' && deal.pass_reason && (
            <p className="text-xs text-text-tertiary">
              Pass reason: <span className="text-text-secondary">{deal.pass_reason}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
