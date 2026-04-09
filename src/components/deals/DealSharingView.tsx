import { useState, useEffect } from 'react'
import { useDealStore } from '../../stores/dealStore'
import { getAPI } from '../../lib/ipc'
import { Button } from '../shared/Button'
import type { Deal } from '../../lib/ipc'

interface ShareableDeal {
  id: string
  companyName: string
  companyUrl: string
  summary: string
  included: boolean
}

/**
 * Format: CompanyName — Summary with metrics inline.
 * See DEAL_SHARING_FORMAT.md for examples.
 */
function formatDealLine(d: ShareableDeal): string {
  let line = d.companyName
  if (d.companyUrl) line += ` (${d.companyUrl})`
  if (d.summary) line += ` — ${d.summary}`
  return line
}

export function DealSharingView() {
  const { deals, fetch: fetchDeals } = useDealStore()
  const [shareableDeals, setShareableDeals] = useState<ShareableDeal[]>([])
  const [copied, setCopied] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newDealName, setNewDealName] = useState('')
  const [loading, setLoading] = useState(true)
  const [enriching, setEnriching] = useState(false)

  useEffect(() => {
    fetchDeals()
  }, [fetchDeals])

  // Auto-populate from deals touched in last 6 weeks
  useEffect(() => {
    if (deals.length === 0) return

    const sixWeeksAgo = new Date()
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42)

    const recentDeals = deals.filter(d => {
      if (d.category === 'not_a_deal') return false
      const updated = new Date(d.updated_at || d.created_at)
      return updated >= sixWeeksAgo
    })

    recentDeals.sort((a, b) => {
      const aActive = a.category !== 'passed'
      const bActive = b.category !== 'passed'
      if (aActive !== bActive) return aActive ? -1 : 1
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    })

    // Deduplicate by company name
    const seen = new Set<string>()
    const dedupedDeals = recentDeals.filter(d => {
      const key = d.company_name.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Build initial summary from existing deal data
    const items: ShareableDeal[] = dedupedDeals.map(d => {
      let summary = d.description || ''
      // Append revenue/round if not already in description
      if (d.revenue && !summary.includes(d.revenue)) {
        summary = summary ? `${summary} ${d.revenue}.` : d.revenue
      }
      if (d.round_size && !summary.includes(d.round_size)) {
        summary = summary ? `${summary} ${d.round_size}.` : d.round_size
      }
      return {
        id: d.id,
        companyName: d.company_name,
        companyUrl: '',
        summary: summary.trim(),
        included: d.category !== 'passed',
      }
    })

    setShareableDeals(items)
    setLoading(false)
  }, [deals])

  // Auto-enrich all deals — generate summaries and fetch URLs
  useEffect(() => {
    if (shareableDeals.length === 0 || enriching) return
    // Enrich all deals (not just those without summary) to get URLs and Gmail context
    const needsEnrich = shareableDeals.filter(d => !d.summary || !d.companyUrl)
    if (needsEnrich.length === 0) return

    setEnriching(true)
    const dealsToEnrich = needsEnrich.map(d => {
      const original = deals.find(deal => deal.company_name === d.companyName)
      return {
        companyId: original?.company_id || d.id,
        companyName: d.companyName,
        contactName: original?.contact_name || '',
      }
    })

    getAPI().deals.generateShareSummaries(dealsToEnrich).then((result: any) => {
      if (result.success && result.summaries?.length > 0) {
        setShareableDeals(prev => prev.map(d => {
          const match = result.summaries.find((s: any) =>
            s.companyName.toLowerCase() === d.companyName.toLowerCase()
          )
          if (!match) return d
          return {
            ...d,
            summary: match.summary || d.summary,
            companyUrl: match.companyUrl || d.companyUrl,
          }
        }))
      }
    }).catch(() => {}).finally(() => setEnriching(false))
  }, [shareableDeals.length])

  const toggleDeal = (id: string) => {
    setShareableDeals(prev => prev.map(d =>
      d.id === id ? { ...d, included: !d.included } : d
    ))
  }

  const updateField = (id: string, field: keyof ShareableDeal, value: string) => {
    setShareableDeals(prev => prev.map(d =>
      d.id === id ? { ...d, [field]: value } : d
    ))
  }

  const removeDeal = (id: string) => {
    setShareableDeals(prev => prev.filter(d => d.id !== id))
  }

  const addManualDeal = () => {
    if (!newDealName.trim()) return
    const newDeal: ShareableDeal = {
      id: `manual-${Date.now()}`,
      companyName: newDealName.trim(),
      companyUrl: '',
      summary: '',
      included: true,
    }
    setShareableDeals(prev => [newDeal, ...prev])
    setNewDealName('')
    setShowAddForm(false)
  }

  const formatForClipboard = () => {
    return shareableDeals.filter(d => d.included).map(formatDealLine).join('\n\n')
  }

  const handleCopy = () => {
    const text = formatForClipboard()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const includedCount = shareableDeals.filter(d => d.included).length

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="text-sm text-text-tertiary">Loading deals...</div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Deal Sharing</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {includedCount} deals selected from last 6 weeks
            {enriching && ' · Generating summaries from meeting notes...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAddForm(true)}>
            + Add
          </Button>
          <Button variant="primary" size="sm" onClick={handleCopy}>
            {copied ? 'Copied!' : `Copy ${includedCount} Deals`}
          </Button>
        </div>
      </div>

      {/* Add manual deal form */}
      {showAddForm && (
        <div className="mb-4 flex items-center gap-2 bg-surface rounded-lg border border-border p-3">
          <input
            type="text"
            value={newDealName}
            onChange={e => setNewDealName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addManualDeal()}
            placeholder="Company name..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none"
          />
          <Button variant="primary" size="sm" onClick={addManualDeal}>Add</Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setNewDealName('') }}>Cancel</Button>
        </div>
      )}

      {/* Preview */}
      <div className="mb-6 bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Preview</h3>
        </div>
        <div className="text-sm text-text-secondary leading-relaxed space-y-2">
          {shareableDeals.filter(d => d.included).length === 0 ? (
            <span className="text-text-tertiary">No deals selected</span>
          ) : (
            shareableDeals.filter(d => d.included).map(d => (
              <p key={d.id}>{formatDealLine(d)}</p>
            ))
          )}
        </div>
      </div>

      {/* Deal list */}
      <div className="space-y-2">
        {shareableDeals.map(deal => (
          <div
            key={deal.id}
            className={`bg-surface rounded-lg border transition-colors ${
              deal.included ? 'border-border' : 'border-border-subtle opacity-50'
            }`}
          >
            <div className="px-4 py-3">
              {/* Row 1: checkbox + name + url + remove */}
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  checked={deal.included}
                  onChange={() => toggleDeal(deal.id)}
                  className="rounded border-border"
                />
                <span className="text-sm font-medium text-text-primary">{deal.companyName}</span>
                <input
                  type="text"
                  value={deal.companyUrl}
                  onChange={e => updateField(deal.id, 'companyUrl', e.target.value)}
                  placeholder="URL"
                  className="w-40 text-xs bg-surface-hover rounded px-2 py-1 text-text-secondary placeholder-text-tertiary outline-none border border-transparent focus:border-accent"
                />
                <div className="flex-1" />
                <button onClick={() => removeDeal(deal.id)} className="text-text-tertiary hover:text-text-secondary text-xs">
                  ✕
                </button>
              </div>

              {/* Row 2: editable summary or loading */}
              <div className="ml-7">
                {enriching && !deal.summary ? (
                  <div className="text-xs text-text-tertiary italic py-1.5 animate-pulse">
                    Generating summary...
                  </div>
                ) : (
                  <textarea
                    value={deal.summary}
                    onChange={e => updateField(deal.id, 'summary', e.target.value)}
                    placeholder="Description with metrics — e.g. 'Voice AI for insurance calls. 6x YoY growth. Raised $15M Series A.'"
                    rows={2}
                    className="w-full text-xs bg-transparent text-text-secondary placeholder-text-tertiary outline-none resize-none border border-transparent rounded focus:border-border-subtle focus:bg-surface-hover p-1.5 leading-relaxed"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
