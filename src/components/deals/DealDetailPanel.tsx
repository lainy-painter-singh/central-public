import { useState, useEffect } from 'react'
import { useDealStore } from '../../stores/dealStore'
import { useScorecardStore } from '../../stores/scorecardStore'
import { getAPI } from '../../lib/ipc'
import { Button } from '../shared/Button'
import { Badge } from '../shared/Badge'
import { PassNoteModal } from './PassNoteModal'
import { DEAL_CATEGORIES } from '../../lib/constants'
import type { Deal } from '../../lib/ipc'
import type { View } from '../../lib/constants'

interface LinkedMeeting {
  id: string
  title: string
  date: string
  source: string
  summary?: string
}

interface Contact {
  name: string
  email: string
  role?: string
}

interface OverviewSection {
  key: string
  title: string
  content: string
}

interface DealOverview {
  sections: OverviewSection[]
  generatedAt: string
  meetingCount: number
}

interface DealDetailPanelProps {
  deal: Deal
  onClose: () => void
  onViewChange?: (view: View) => void
}

export function DealDetailPanel({ deal, onClose, onViewChange }: DealDetailPanelProps) {
  const { update, updateCategory, remove } = useDealStore()
  const initScorecard = useScorecardStore(s => s.initFromDeal)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [isEditingDesc, setIsEditingDesc] = useState(false)
  const [notes, setNotes] = useState(deal.notes || '')
  const [description, setDescription] = useState(deal.description || '')
  const [revenue, setRevenue] = useState(deal.revenue || '')
  const [roundSize, setRoundSize] = useState(deal.round_size || '')
  const [showPassNote, setShowPassNote] = useState(false)
  const [linkedMeetings, setLinkedMeetings] = useState<LinkedMeeting[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null)
  const [overview, setOverview] = useState<DealOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState(deal.company_name)

  useEffect(() => {
    const api = getAPI()
    console.log('[DealPanel] Opening deal:', deal.company_id, deal.company_name)

    api.deals.getLinkedMeetings(deal.company_id, deal.company_name)
      .then((m: LinkedMeeting[]) => { console.log('[DealPanel] Linked meetings:', m.length); setLinkedMeetings(m) })
      .catch((e: any) => console.error('[DealPanel] getLinkedMeetings error:', e))

    api.deals.getCompanyContacts(deal.company_id)
      .then((c: Contact[]) => { console.log('[DealPanel] Contacts:', c.length); setContacts(c) })
      .catch((e: any) => console.error('[DealPanel] getCompanyContacts error:', e))

    // Load cached overview first, then auto-generate if none cached
    api.deals.getCachedOverview(deal.company_id).then((cached: DealOverview | null) => {
      console.log('[DealPanel] Cached overview:', cached ? 'found' : 'none')
      if (cached) {
        setOverview(cached)
      } else {
        // Auto-generate — the backend checks both DB meetings AND vault files
        setOverviewLoading(true)
        console.log('[DealPanel] Auto-generating overview...')
        api.deals.generateOverview(deal.company_id, deal.company_name).then((result: any) => {
          console.log('[DealPanel] Overview result:', result.success, result.error || '')
          if (result.success && result.overview?.meetingCount > 0) setOverview(result.overview)
        }).catch((e: any) => console.error('[DealPanel] generateOverview error:', e)).finally(() => setOverviewLoading(false))
      }
    }).catch((e: any) => console.error('[DealPanel] getCachedOverview error:', e))
  }, [deal.company_id, deal.company_name])

  const handleSaveName = async () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== deal.company_name) {
      const api = getAPI()
      await api.companies.rename(deal.company_id, trimmed)
      // Re-fetch deals so the list updates with the new name
      const { fetch: refetch } = useDealStore.getState()
      await refetch()
    }
    setIsEditingName(false)
  }

  const regenerateOverview = () => {
    const api = getAPI()
    setOverviewLoading(true)
    api.deals.generateOverview(deal.company_id, deal.company_name).then((result: any) => {
      if (result.success) setOverview(result.overview)
    }).catch(() => {}).finally(() => setOverviewLoading(false))
  }

  const handleSaveNotes = () => {
    update(deal.id, { notes })
    setIsEditingNotes(false)
  }

  const handleSaveDesc = () => {
    update(deal.id, { description, revenue, round_size: roundSize })
    setIsEditingDesc(false)
  }

  const handlePass = () => {
    setShowPassNote(true)
  }

  return (
    <>
      {/* Slide-out panel */}
      <div className="fixed inset-y-0 right-0 w-[420px] bg-surface-raised border-l border-border shadow-2xl z-40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0 mr-3">
            {isEditingName ? (
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') { setEditName(deal.company_name); setIsEditingName(false) }
                }}
                autoFocus
                className="text-base font-semibold text-text-primary bg-surface border border-accent rounded px-2 py-0.5 w-full outline-none"
              />
            ) : (
              <h2
                className="text-base font-semibold text-text-primary cursor-pointer hover:text-accent transition-colors"
                onClick={() => { setEditName(deal.company_name); setIsEditingName(true) }}
                title="Click to rename"
              >
                {deal.company_name}
              </h2>
            )}
            {deal.description && !isEditingName && (
              <p className="text-xs text-text-secondary mt-0.5 truncate">{deal.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="relationship" relationship={deal.relationship}>
                {deal.relationship?.replace('_', ' ')}
              </Badge>
              <span className="text-xs text-text-tertiary capitalize">
                {deal.category?.replace(/_/g, ' ') || deal.stage?.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contacts */}
          {(deal.contact_name || deal.contact_email || contacts.length > 0) && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Contacts</h3>
              {/* Primary contact */}
              {deal.contact_name && (
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm text-text-primary font-medium">{deal.contact_name}</p>
                  {deal.contact_email && <span className="text-xs text-text-tertiary">{deal.contact_email}</span>}
                </div>
              )}
              {/* Additional contacts from enrichment */}
              {contacts.filter(c => c.email !== deal.contact_email).slice(0, 5).map(c => (
                <div key={c.email} className="flex items-center gap-2 text-xs text-text-secondary py-0.5">
                  <span>{c.name}</span>
                  <span className="text-text-tertiary">{c.email}</span>
                </div>
              ))}
            </div>
          )}

          {/* Source */}
          {deal.source && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Source</h3>
              <p className="text-sm text-text-secondary">{deal.source}</p>
            </div>
          )}

          {/* Category Selector */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Category</h3>
            <div className="flex flex-wrap gap-1.5">
              {DEAL_CATEGORIES.filter(cat => cat.id !== 'not_a_deal').map(cat => (
                <button
                  key={cat.id}
                  onClick={() => updateCategory(deal.id, cat.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    deal.category === cat.id
                      ? 'bg-accent/20 text-accent'
                      : 'bg-surface hover:bg-surface-hover text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Description</h3>
              {!isEditingDesc && (
                <button
                  onClick={() => setIsEditingDesc(true)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditingDesc ? (
              <div className="space-y-2">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent resize-none"
                  placeholder="1-3 sentence company summary..."
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={revenue}
                    onChange={e => setRevenue(e.target.value)}
                    placeholder="Revenue (e.g. $2M ARR)"
                    className="flex-1 px-3 py-1.5 bg-surface border border-border rounded-md text-xs text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    value={roundSize}
                    onChange={e => setRoundSize(e.target.value)}
                    placeholder="Round size (e.g. $10M Series A)"
                    className="flex-1 px-3 py-1.5 bg-surface border border-border rounded-md text-xs text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setIsEditingDesc(false); setDescription(deal.description || ''); setRevenue(deal.revenue || ''); setRoundSize(deal.round_size || '') }}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveDesc}>Save</Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">
                  {deal.description || 'No description yet'}
                </p>
                {(deal.revenue || deal.round_size) && (
                  <div className="flex gap-3 mt-1.5 text-xs text-text-tertiary">
                    {deal.revenue && <span>Revenue: {deal.revenue}</span>}
                    {deal.round_size && <span>Round: {deal.round_size}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Notes</h3>
              {!isEditingNotes && (
                <button
                  onClick={() => setIsEditingNotes(true)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={6}
                  autoFocus
                  className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent resize-none"
                  placeholder="Add notes about this deal..."
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="ghost" size="sm" onClick={() => { setIsEditingNotes(false); setNotes(deal.notes || '') }}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveNotes}>Save</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                {deal.notes || 'No notes yet'}
              </p>
            )}
          </div>

          {/* Meeting Overview */}
          {(overview || overviewLoading || linkedMeetings.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Meeting Overview {linkedMeetings.length > 0 && `(${linkedMeetings.length} meetings)`}
                </h3>
                {overview && (
                  <button onClick={regenerateOverview} className="text-xs text-accent hover:text-accent-hover">
                    {overviewLoading ? 'Generating...' : 'Refresh'}
                  </button>
                )}
              </div>

              {overviewLoading && !overview && (
                <div className="text-xs text-text-tertiary py-3 text-center">
                  Analyzing meeting notes...
                </div>
              )}

              {overview && (
                <div className="bg-surface rounded-lg border border-border-subtle p-3 text-xs text-text-secondary space-y-3">
                  {overview.sections
                    .filter(s => s.content !== 'Not discussed in meetings.')
                    .map(section => (
                      <div key={section.key}>
                        <h4 className="text-xs font-semibold text-text-primary mb-1">{section.title}</h4>
                        <p className="whitespace-pre-wrap leading-relaxed">{section.content}</p>
                      </div>
                    ))}
                </div>
              )}

              {/* Raw meeting list (collapsible) */}
              {linkedMeetings.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setExpandedMeeting(expandedMeeting === '_list' ? null : '_list')}
                    className="text-xs text-text-tertiary hover:text-text-secondary"
                  >
                    {expandedMeeting === '_list' ? 'Hide' : 'Show'} raw meetings
                  </button>
                  {expandedMeeting === '_list' && (
                    <div className="space-y-1 mt-1.5 max-h-40 overflow-y-auto">
                      {linkedMeetings.map(m => (
                        <div key={m.id} className="flex items-center gap-2 px-2 py-1 text-xs text-text-tertiary">
                          <span className="w-20 shrink-0">{m.date}</span>
                          <span className="truncate flex-1">{m.title}</span>
                          <span className="text-[10px] uppercase">{m.source}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pass Note (if passed) */}
          {deal.pass_note && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Pass Note</h3>
              <div className="bg-surface rounded-lg p-3 text-sm text-text-secondary whitespace-pre-wrap border border-border-subtle">
                {deal.pass_note}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-border flex items-center gap-2">
          {deal.category !== 'passed' && deal.category !== 'not_a_deal' && (
            <Button variant="danger" size="sm" onClick={handlePass}>
              Pass
            </Button>
          )}
          {onViewChange && deal.category !== 'passed' && deal.category !== 'not_a_deal' && (
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await initScorecard(deal.id)
                onClose()
                onViewChange('scorecard')
              }}
            >
              Build Scorecard
            </Button>
          )}
          <div className="flex-1" />
          {deal.category !== 'not_a_deal' && (
            <Button variant="ghost" size="sm" onClick={() => { updateCategory(deal.id, 'not_a_deal' as any); onClose() }}>
              Not a Deal
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => remove(deal.id)}>
            Delete
          </Button>
        </div>
      </div>

      {/* Backdrop */}
      <div className="fixed inset-0 z-30" onClick={onClose} />

      {/* Pass Note Modal */}
      <PassNoteModal
        open={showPassNote}
        deal={deal}
        onClose={() => setShowPassNote(false)}
      />
    </>
  )
}
