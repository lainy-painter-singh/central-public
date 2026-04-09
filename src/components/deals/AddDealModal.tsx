import { useState } from 'react'
import { useDealStore } from '../../stores/dealStore'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { DEAL_CATEGORIES } from '../../lib/constants'

interface AddDealModalProps {
  open: boolean
  onClose: () => void
}

export function AddDealModal({ open, onClose }: AddDealModalProps) {
  const { create } = useDealStore()
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('first_meeting')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!companyName.trim()) return
    setSaving(true)
    try {
      const companyId = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      await create({
        company_id: companyId,
        company_name: companyName.trim(),
        category,
        source: source || undefined,
        contact_name: contactName || undefined,
        contact_email: contactEmail || undefined,
        description: description || undefined,
      } as any)
      // Reset
      setCompanyName('')
      setContactName('')
      setContactEmail('')
      setSource('')
      setCategory('first_meeting')
      setDescription('')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Deal">
      <div className="space-y-4">
        {/* Company Name */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Company Name
          </label>
          <input
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="e.g., Acme Corp"
            autoFocus
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
          />
        </div>

        {/* Category */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Category
          </label>
          <div className="flex gap-1.5">
            {DEAL_CATEGORIES.filter(c => c.id !== 'passed').map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  category === cat.id
                    ? 'bg-accent/20 text-accent'
                    : 'bg-surface-hover text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
              Contact Name
            </label>
            <input
              type="text"
              value={contactName}
              onChange={e => setContactName(e.target.value)}
              placeholder="e.g., Sarah Johnson"
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
              Contact Email
            </label>
            <input
              type="text"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              placeholder="sarah@acme.com"
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Source */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Source
          </label>
          <input
            type="text"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="e.g., Referred by Mike, inbound, conference..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="1-3 sentence summary of the company..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!companyName.trim() || saving}
          >
            Add Deal
          </Button>
        </div>
      </div>
    </Modal>
  )
}
