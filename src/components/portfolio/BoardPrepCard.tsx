import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '../shared/Button'
import { getAPI } from '../../lib/ipc'
import type { BoardPrep, BoardQuestion } from '../../lib/ipc'

interface BoardPrepCardProps {
  companyId: string
  companyName: string
}

const THEME_COLORS: Record<string, string> = {
  Financial: 'text-green-400',
  Product: 'text-blue-400',
  GTM: 'text-orange-400',
  Team: 'text-purple-400',
  Strategy: 'text-cyan-400',
  General: 'text-text-tertiary',
}

const THEME_ICONS: Record<string, string> = {
  Financial: '$',
  Product: '◆',
  GTM: '▸',
  Team: '●',
  Strategy: '◈',
  General: '○',
}

export function BoardPrepCard({ companyId, companyName }: BoardPrepCardProps) {
  const [boardPrep, setBoardPrep] = useState<BoardPrep | null>(null)
  const [questions, setQuestions] = useState<BoardQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set())
  const [showSummary, setShowSummary] = useState(false)
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)

  useEffect(() => {
    loadBoardPrep()
  }, [companyId])

  const loadBoardPrep = async () => {
    setLoading(true)
    try {
      const prep = await getAPI().boardPrep.getLatest(companyId)
      if (prep) {
        setBoardPrep(prep)
        const parsed = JSON.parse(prep.questions || '[]') as BoardQuestion[]
        setQuestions(parsed)
        setSummaryText(prep.summary_final || prep.summary_draft || '')
        // Auto-expand all themes
        const themes = new Set(parsed.map(q => q.theme))
        setExpandedThemes(themes)
      }
    } catch (err) {
      console.error('Failed to load board prep:', err)
    }
    setLoading(false)
  }

  if (loading) return null
  if (!boardPrep) return null

  const groupedByTheme = questions.reduce((acc, q) => {
    if (!acc[q.theme]) acc[q.theme] = []
    acc[q.theme].push(q)
    return acc
  }, {} as Record<string, BoardQuestion[]>)

  const themes = Object.keys(groupedByTheme)
  const checkedCount = questions.filter(q => q.checked).length

  const toggleTheme = (theme: string) => {
    setExpandedThemes(prev => {
      const next = new Set(prev)
      if (next.has(theme)) next.delete(theme)
      else next.add(theme)
      return next
    })
  }

  const toggleQuestion = async (idx: number) => {
    const updated = [...questions]
    updated[idx] = { ...updated[idx], checked: !updated[idx].checked }
    setQuestions(updated)
    // Persist
    await getAPI().boardPrep.updateQuestions(boardPrep!.id, updated)
  }

  const handleGenerateQuestions = async () => {
    setGenerating(true)
    try {
      const result = await getAPI().boardPrep.generateQuestions(boardPrep!.id)
      if (result.success && result.questions) {
        setQuestions(result.questions)
        const newThemes = new Set(result.questions.map((q: BoardQuestion) => q.theme))
        setExpandedThemes(newThemes)
      }
    } catch (err) {
      console.error('Failed to generate questions:', err)
    }
    setGenerating(false)
  }

  const handleDraftSummary = async () => {
    setDrafting(true)
    setDraftError(null)
    try {
      const result = await getAPI().boardPrep.draftSummary(boardPrep!.id)
      if (result.success && result.summary) {
        setSummaryText(result.summary)
        setShowSummary(true)
        setBoardPrep(prev => prev ? { ...prev, summary_draft: result.summary! } : null)
      } else if (!result.success) {
        setDraftError(result.error || 'Failed to draft summary')
        setShowSummary(true)
      }
    } catch (err) {
      console.error('Failed to draft summary:', err)
      setDraftError('Failed to draft summary')
      setShowSummary(true)
    }
    setDrafting(false)
  }

  const handleSaveSummary = async (isFinal: boolean) => {
    await getAPI().boardPrep.saveSummary(boardPrep!.id, summaryText, isFinal)
    setBoardPrep(prev => {
      if (!prev) return null
      return isFinal
        ? { ...prev, summary_final: summaryText }
        : { ...prev, summary_draft: summaryText }
    })
    setEditingSummary(false)
  }

  const handleMarkGluePosted = async () => {
    await getAPI().boardPrep.markGluePosted(boardPrep!.id)
    setBoardPrep(prev => prev ? { ...prev, glue_posted: 1 } : null)
  }

  return (
    <div className="border-t border-border-subtle">
      {/* Board Prep Header */}
      <div className="px-4 py-2.5 bg-surface-hover/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-board-seat">◈</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Board Prep
            </span>
            {boardPrep.meeting_date && (
              <span className="text-xs text-text-tertiary">
                {format(new Date(boardPrep.meeting_date), 'MMM d, yyyy')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {questions.length > 0 && (
              <span className="text-xs text-text-tertiary tabular-nums">
                {checkedCount}/{questions.length} reviewed
              </span>
            )}
            {boardPrep.glue_posted ? (
              <span className="text-xs text-success">Posted to Glue</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Questions by Theme */}
      {themes.length > 0 ? (
        <div className="divide-y divide-border-subtle">
          {themes.map(theme => {
            const themeQuestions = groupedByTheme[theme]
            const isExpanded = expandedThemes.has(theme)
            const themeColor = THEME_COLORS[theme] || THEME_COLORS.General
            const themeIcon = THEME_ICONS[theme] || THEME_ICONS.General
            const themeChecked = themeQuestions.filter(q => q.checked).length

            return (
              <div key={theme}>
                {/* Theme Header */}
                <button
                  onClick={() => toggleTheme(theme)}
                  className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-hover transition-colors"
                >
                  <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                    ▸
                  </span>
                  <span className={`text-xs ${themeColor}`}>{themeIcon}</span>
                  <span className={`text-xs font-medium ${themeColor}`}>{theme}</span>
                  <span className="text-xs text-text-tertiary tabular-nums">
                    {themeChecked}/{themeQuestions.length}
                  </span>
                </button>

                {/* Questions */}
                {isExpanded && (
                  <div className="pl-8 pr-4 pb-2 space-y-1">
                    {themeQuestions.map((q, i) => {
                      const globalIdx = questions.findIndex(
                        gq => gq.theme === q.theme && gq.question === q.question
                      )
                      return (
                        <label
                          key={i}
                          className="flex items-start gap-2 py-1 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={q.checked}
                            onChange={() => toggleQuestion(globalIdx)}
                            className="mt-0.5 rounded border-text-tertiary text-accent focus:ring-accent bg-transparent"
                          />
                          <span className={`text-xs leading-relaxed ${
                            q.checked ? 'text-text-tertiary line-through' : 'text-text-secondary'
                          }`}>
                            {q.question}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-text-tertiary mb-2">No board prep questions yet</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerateQuestions}
            disabled={generating}
          >
            {generating ? 'Generating...' : 'Generate Questions from Meetings'}
          </Button>
        </div>
      )}

      {/* Actions Row */}
      <div className="px-4 py-2 border-t border-border-subtle flex items-center gap-2">
        {questions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerateQuestions}
            disabled={generating}
          >
            {generating ? 'Generating...' : '+ More Questions'}
          </Button>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!summaryText && !showSummary) {
              handleDraftSummary()
              setShowSummary(true)
            } else {
              setShowSummary(!showSummary)
            }
          }}
        >
          {drafting ? 'Drafting...' : showSummary ? 'Hide Summary' : summaryText ? 'Show Summary' : 'Draft Summary'}
        </Button>
        {!boardPrep.glue_posted && (
          <Button variant="ghost" size="sm" onClick={handleMarkGluePosted}>
            Mark Posted to Glue
          </Button>
        )}
      </div>

      {/* Summary Section */}
      {showSummary && (
        <div className="px-4 py-3 border-t border-border-subtle bg-surface-hover/20">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Board Summary
              {boardPrep.summary_final && <span className="text-success ml-1">(Final)</span>}
            </h4>
            <div className="flex gap-1.5">
              {!editingSummary && (
                <>
                  {!summaryText && (
                    <Button variant="primary" size="sm" onClick={handleDraftSummary} disabled={drafting}>
                      {drafting ? 'Drafting...' : 'Auto-Draft'}
                    </Button>
                  )}
                  {summaryText && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingSummary(true)}>
                      Edit
                    </Button>
                  )}
                  {summaryText && (
                    <Button variant="primary" size="sm" onClick={handleDraftSummary} disabled={drafting}>
                      {drafting ? 'Redrafting...' : 'Redraft'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {editingSummary ? (
            <div>
              <textarea
                value={summaryText}
                onChange={e => setSummaryText(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md text-xs text-text-primary font-mono leading-relaxed placeholder-text-tertiary outline-none focus:border-accent resize-none"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditingSummary(false)}>
                  Cancel
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleSaveSummary(false)}>
                  Save Draft
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleSaveSummary(true)}>
                  Save as Final
                </Button>
              </div>
            </div>
          ) : summaryText ? (
            <div className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed bg-surface rounded-lg p-3 border border-border-subtle">
              {summaryText}
            </div>
          ) : (
            <div className="text-xs text-center py-4">
              {draftError ? (
                <span className="text-red-400">{draftError}</span>
              ) : (
                <span className="text-text-tertiary">No summary yet. Click "Auto-Draft" to generate from meeting notes and email.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
