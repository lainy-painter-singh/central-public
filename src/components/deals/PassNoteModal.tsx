import { useState } from 'react'
import { useDealStore } from '../../stores/dealStore'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import type { Deal } from '../../lib/ipc'
import { getAPI } from '../../lib/ipc'

interface PassNoteModalProps {
  open: boolean
  deal: Deal
  onClose: () => void
}

export function PassNoteModal({ open, deal, onClose }: PassNoteModalProps) {
  const { update, updateCategory } = useDealStore()
  const [reason, setReason] = useState(deal.pass_reason || '')
  const [note, setNote] = useState(deal.pass_note || '')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await getAPI().passNote.generate(deal.id, reason)
      if (result.success && result.note) {
        setNote(result.note)
      }
    } catch {
      // Generation failed — user can still edit manually
    } finally {
      setGenerating(false)
    }
  }

  const handleSaveAndPass = async () => {
    setSaving(true)
    try {
      await update(deal.id, {
        pass_reason: reason,
        pass_note: note,
      })
      await updateCategory(deal.id, 'passed')

      // Try to create Gmail draft
      if (deal.contact_email) {
        try {
          const result = await getAPI().gmail.createDraft(
            deal.contact_email,
            `Following up - ${deal.company_name}`,
            note
          )
          if (result.success) {
            setStatus('Draft created in Gmail')
          } else {
            setStatus('Note saved (Gmail not connected)')
          }
        } catch {
          setStatus('Note saved (Gmail not connected)')
        }
      } else {
        setStatus('Marked as passed')
      }

      // Brief pause so user sees confirmation
      setTimeout(() => onClose(), 1500)
    } catch {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Pass on ${deal.company_name}`} width="max-w-xl">
      <div className="space-y-4">
        {/* Reason */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Reason for passing
          </label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g., too early stage, market concerns, competitive dynamics..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
          />
        </div>

        {/* Generate Button */}
        <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating...' : 'Generate with AI'}
        </Button>

        {/* Pass Note Editor */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block mb-1.5">
            Pass Note
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={12}
            placeholder="Click 'Generate with AI' or write your note here..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent resize-none font-mono leading-relaxed"
          />
        </div>

        {/* Recipient */}
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span>To:</span>
          <span className="text-text-secondary">
            {deal.contact_email || 'No email on file — add contact email to send'}
          </span>
        </div>

        {/* Status message */}
        {status && (
          <div className="text-xs text-green-400 font-medium py-1">
            {status}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveAndPass}
            disabled={saving || !note.trim()}
          >
            {saving ? 'Saving...' : deal.contact_email ? 'Save & Create Gmail Draft' : 'Save & Mark Passed'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
