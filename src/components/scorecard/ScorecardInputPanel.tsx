import { useScorecardStore } from '../../stores/scorecardStore'
import { FileDropZone } from './FileDropZone'
import { Button } from '../shared/Button'
import { format } from 'date-fns'

export function ScorecardInputPanel() {
  const {
    activeScorecard,
    suggestedMeetings,
    selectedMeetingIds,
    uploadedFiles,
    additionalNotes,
    generating,
    error,
    addFile,
    removeFile,
    toggleMeeting,
    setAdditionalNotes,
    generate,
  } = useScorecardStore()

  if (!activeScorecard) return null

  const dealContext = JSON.parse(activeScorecard.deal_context || '{}')
  const hasContent = uploadedFiles.length > 0 || selectedMeetingIds.size > 0 || additionalNotes.trim().length > 0

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Deal Context */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Deal Context</h3>
        <div className="bg-surface rounded-lg p-3 border border-border-subtle space-y-1">
          <p className="text-sm font-medium text-text-primary">{dealContext.company_name}</p>
          {dealContext.description && (
            <p className="text-xs text-text-secondary">{dealContext.description}</p>
          )}
          <div className="flex gap-3 text-xs text-text-tertiary">
            {dealContext.revenue && <span>Revenue: {dealContext.revenue}</span>}
            {dealContext.round_size && <span>Round: {dealContext.round_size}</span>}
          </div>
          {dealContext.source && (
            <p className="text-xs text-text-tertiary">Source: {dealContext.source}</p>
          )}
        </div>
      </section>

      {/* File Upload */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
          Documents
          {uploadedFiles.length > 0 && <span className="text-accent ml-1">{uploadedFiles.length}</span>}
        </h3>
        <FileDropZone onFileDrop={addFile} />
        {uploadedFiles.length > 0 && (
          <div className="mt-2 space-y-1">
            {uploadedFiles.map((file, i) => (
              <div key={i} className="flex items-center justify-between bg-surface rounded px-2.5 py-1.5 border border-border-subtle">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-accent shrink-0">
                    {file.filename.endsWith('.pdf') ? 'PDF' :
                     file.filename.endsWith('.xlsx') || file.filename.endsWith('.xls') ? 'XLS' :
                     file.filename.endsWith('.csv') ? 'CSV' : 'TXT'}
                  </span>
                  <span className="text-xs text-text-secondary truncate">{file.filename}</span>
                </div>
                <button
                  onClick={() => removeFile(i)}
                  className="text-text-tertiary hover:text-text-primary text-xs shrink-0 ml-2"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Meeting Notes */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
          Meeting Notes
          {selectedMeetingIds.size > 0 && <span className="text-accent ml-1">{selectedMeetingIds.size}</span>}
        </h3>
        {suggestedMeetings.length > 0 ? (
          <div className="space-y-1">
            {suggestedMeetings.map(meeting => {
              const selected = selectedMeetingIds.has(meeting.id)
              return (
                <button
                  key={meeting.id}
                  onClick={() => toggleMeeting(meeting.id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded border transition-colors ${
                    selected
                      ? 'border-accent/30 bg-accent/5'
                      : 'border-border-subtle bg-surface hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${selected ? 'text-accent' : 'text-text-tertiary'}`}>
                      {selected ? '◉' : '○'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-secondary truncate">{meeting.title}</p>
                      <p className="text-[10px] text-text-tertiary">
                        {meeting.date && format(new Date(meeting.date), 'MMM d, yyyy')}
                        <span className="ml-1.5 opacity-60">{meeting.source}</span>
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary text-center py-2">
            No meetings found for this company
          </p>
        )}
      </section>

      {/* Additional Notes */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">Additional Notes</h3>
        <textarea
          value={additionalNotes}
          onChange={e => setAdditionalNotes(e.target.value)}
          rows={4}
          placeholder="Add any additional context, analysis, or specific instructions for the scorecard..."
          className="w-full px-3 py-2 bg-surface border border-border rounded-md text-xs text-text-primary placeholder-text-tertiary outline-none focus:border-accent resize-none"
        />
      </section>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Generate Button */}
      <div className="pt-2">
        <Button
          variant="primary"
          size="sm"
          onClick={generate}
          disabled={generating}
          className="w-full"
        >
          {generating ? 'Generating Scorecard...' : 'Generate ITM Scorecard'}
        </Button>
        {!hasContent && !generating && (
          <p className="text-[10px] text-text-tertiary text-center mt-1.5">
            Add documents, meetings, or notes for better results
          </p>
        )}
      </div>
    </div>
  )
}
