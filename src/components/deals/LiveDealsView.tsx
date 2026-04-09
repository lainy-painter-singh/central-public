import { useState, useEffect } from 'react'
import { useDealStore } from '../../stores/dealStore'
import { DealRow } from './DealRow'
import { DealDetailPanel } from './DealDetailPanel'
import { AddDealModal } from './AddDealModal'
import { Button } from '../shared/Button'
import { EmptyState } from '../shared/EmptyState'
import { DEAL_CATEGORIES } from '../../lib/constants'
import type { Deal } from '../../lib/ipc'
import type { DealCategory, View } from '../../lib/constants'

interface LiveDealsViewProps {
  onViewChange?: (view: View) => void
}

export function LiveDealsView({ onViewChange }: LiveDealsViewProps) {
  const { deals, loading, fetch, updateCategory, selectedDealId, selectDeal } = useDealStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)

  useEffect(() => { fetch() }, [])

  const selectedDeal = deals.find(d => d.id === selectedDealId)

  // Passed deals sunset after 48 hours — hide from the list
  const SUNSET_MS = 48 * 60 * 60 * 1000
  const now = Date.now()

  const dealsByCategory = DEAL_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = deals.filter(d => {
      if (d.category !== cat.id) return false
      if (cat.id === 'passed' && d.moved_at) {
        const movedAt = new Date(d.moved_at + 'Z').getTime()
        if (now - movedAt > SUNSET_MS) return false
      }
      return true
    })
    return acc
  }, {} as Record<string, Deal[]>)

  const toggleSection = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDragStart = (dealId: string) => {
    setDraggedDealId(dealId)
  }

  const handleDragOver = (e: React.DragEvent, categoryId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCategory(categoryId)
  }

  const handleDragLeave = () => {
    setDragOverCategory(null)
  }

  const handleDrop = async (e: React.DragEvent, categoryId: string) => {
    e.preventDefault()
    setDragOverCategory(null)
    if (draggedDealId) {
      await updateCategory(draggedDealId, categoryId)
      setDraggedDealId(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedDealId(null)
    setDragOverCategory(null)
  }

  const activeDealCount = deals.filter(d => d.category !== 'passed' && d.category !== 'not_a_deal').length

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Live Deals</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {activeDealCount} active · {dealsByCategory.passed?.length || 0} passed
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          + Add Deal
        </Button>
      </div>

      {deals.length === 0 && !loading ? (
        <EmptyState
          icon="◫"
          title="No deals yet"
          description="Add your first deal to start tracking your pipeline."
          action={
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              Add Deal
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {DEAL_CATEGORIES.filter(cat => cat.id !== 'not_a_deal').map(cat => {
            const catDeals = dealsByCategory[cat.id] || []
            const isCollapsed = collapsedSections.has(cat.id)
            const isDragOver = dragOverCategory === cat.id

            return (
              <section
                key={cat.id}
                onDragOver={(e) => handleDragOver(e, cat.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, cat.id)}
              >
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(cat.id)}
                  className="flex items-center gap-2 w-full mb-2 group"
                >
                  <span className={`text-xs transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                    ▸
                  </span>
                  <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary group-hover:text-text-secondary transition-colors">
                    {cat.label}
                  </h2>
                  <span className="text-xs text-text-tertiary tabular-nums">{catDeals.length}</span>
                </button>

                {/* Section Content */}
                {!isCollapsed && (
                  <div
                    className={`rounded-lg border transition-colors ${
                      isDragOver
                        ? 'border-accent bg-accent/5'
                        : catDeals.length > 0
                        ? 'border-border-subtle bg-surface-raised'
                        : 'border-border-subtle border-dashed'
                    }`}
                  >
                    {catDeals.length === 0 ? (
                      <div className="px-4 py-3 text-center">
                        <p className="text-xs text-text-tertiary">
                          {isDragOver ? 'Drop here' : 'No deals — drag here or add one'}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border-subtle">
                        {catDeals.map(deal => (
                          <DealRow
                            key={deal.id}
                            deal={deal}
                            onDragStart={() => handleDragStart(deal.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => selectDeal(deal.id)}
                            isSelected={deal.id === selectedDealId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* Deal Detail Panel */}
      {selectedDeal && (
        <DealDetailPanel
          deal={selectedDeal}
          onClose={() => selectDeal(null)}
          onViewChange={onViewChange}
        />
      )}

      {/* Add Deal Modal */}
      <AddDealModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />
    </div>
  )
}
