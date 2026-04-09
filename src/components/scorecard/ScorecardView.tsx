import { useEffect } from 'react'
import { useScorecardStore } from '../../stores/scorecardStore'
import { useDealStore } from '../../stores/dealStore'
import { ScorecardInputPanel } from './ScorecardInputPanel'
import { ScorecardOutputPanel } from './ScorecardOutputPanel'
import type { View } from '../../lib/constants'

interface ScorecardViewProps {
  onViewChange?: (view: View) => void
}

export function ScorecardView({ onViewChange }: ScorecardViewProps) {
  const { activeScorecard, activeDealId, reset } = useScorecardStore()
  const deals = useDealStore(s => s.deals)

  // If no deal selected, show empty state
  if (!activeDealId && !activeScorecard) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-6 py-5 border-b border-border">
          <h1 className="text-lg font-semibold text-text-primary">Scorecard Builder</h1>
          <p className="text-xs text-text-tertiary mt-1">Generate ITM investment scorecards</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-sm text-text-tertiary">Select a deal to build a scorecard</p>
            <p className="text-xs text-text-tertiary opacity-60">
              Go to Live Deals and click "Build Scorecard" on any deal
            </p>
            {onViewChange && (
              <button
                onClick={() => onViewChange('deals')}
                className="px-4 py-1.5 rounded-md text-xs bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Go to Live Deals
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const dealContext = activeScorecard ? JSON.parse(activeScorecard.deal_context || '{}') : {}

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-4 shrink-0">
        <button
          onClick={() => {
            reset()
            onViewChange?.('deals')
          }}
          className="text-text-tertiary hover:text-text-primary transition-colors text-sm"
        >
          ← Deals
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-text-primary">
            Scorecard: {dealContext.company_name || 'Loading...'}
          </h1>
          {activeScorecard?.status === 'complete' && (
            <span className="text-[10px] text-success">Generated</span>
          )}
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Input panel */}
        <div className="w-[380px] border-r border-border shrink-0">
          <ScorecardInputPanel />
        </div>

        {/* Right: Output panel */}
        <div className="flex-1">
          <ScorecardOutputPanel />
        </div>
      </div>
    </div>
  )
}
