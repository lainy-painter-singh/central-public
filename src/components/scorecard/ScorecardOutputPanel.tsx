import { useScorecardStore } from '../../stores/scorecardStore'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SLIDE_TABS = [
  { label: 'Exec Summary', key: 'slide_executive_summary' },
  { label: 'Highlights & Risks', key: 'slide_highlights_risks' },
  { label: 'Scorecard', key: 'slide_scorecard_table' },
  { label: 'Hypothesis', key: 'slide_hypothesis_framework' },
] as const

const RATING_COLORS: Record<string, string> = {
  'Strong': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Strong / Neutral': 'bg-lime-500/15 text-lime-400 border-lime-500/25',
  'Neutral': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  'Neutral / Weak': 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'Weak': 'bg-red-500/15 text-red-400 border-red-500/25',
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      prose-headings:text-text-primary prose-headings:font-semibold
      prose-h2:text-sm prose-h2:uppercase prose-h2:tracking-wider prose-h2:mt-6 prose-h2:mb-3
      prose-h3:text-xs prose-h3:mt-4 prose-h3:mb-2
      prose-p:text-text-secondary prose-p:text-xs prose-p:leading-relaxed
      prose-li:text-text-secondary prose-li:text-xs prose-li:leading-relaxed
      prose-strong:text-text-primary
      prose-table:text-xs
      prose-th:text-text-tertiary prose-th:font-semibold prose-th:px-2 prose-th:py-1.5 prose-th:border-border
      prose-td:text-text-secondary prose-td:px-2 prose-td:py-1.5 prose-td:border-border
    ">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}

function ScorecardTable({ data }: { data: string }) {
  let parsed: any = { categories: [] }
  try {
    parsed = JSON.parse(data)
  } catch { /* use default */ }

  const categories = parsed.categories || []

  if (categories.length === 0) {
    return <p className="text-xs text-text-tertiary text-center py-8">No scorecard data</p>
  }

  return (
    <div className="space-y-0">
      {/* Table header */}
      <div className="grid grid-cols-[140px_100px_1fr] gap-0 border-b border-border">
        <div className="px-3 py-2 bg-surface-hover">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Category</span>
        </div>
        <div className="px-3 py-2 bg-surface-hover text-center">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Rating</span>
        </div>
        <div className="px-3 py-2 bg-surface-hover">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Assessment</span>
        </div>
      </div>

      {categories.map((cat: any, i: number) => {
        const ratingClass = RATING_COLORS[cat.rating] || RATING_COLORS['Neutral']
        return (
          <div key={i} className="grid grid-cols-[140px_100px_1fr] gap-0 border-b border-border-subtle">
            {/* Category name */}
            <div className="px-3 py-3 bg-surface-hover/50">
              <p className="text-xs font-semibold text-text-primary">{cat.name}</p>
              {cat.sub_label && (
                <p className="text-[10px] text-text-tertiary italic mt-0.5">{cat.sub_label}</p>
              )}
            </div>

            {/* Rating */}
            <div className="px-3 py-3 flex items-center justify-center">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${ratingClass}`}>
                {cat.rating}
              </span>
            </div>

            {/* Bullets */}
            <div className="px-3 py-3">
              <ul className="space-y-1">
                {(cat.bullets || []).map((bullet: string, j: number) => (
                  <li key={j} className="text-xs text-text-secondary leading-relaxed flex gap-1.5">
                    <span className="text-text-tertiary mt-0.5 shrink-0">--</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ScorecardOutputPanel() {
  const { activeScorecard, activeSlideIndex, setActiveSlide, generating } = useScorecardStore()

  if (!activeScorecard) return null

  const isComplete = activeScorecard.status === 'complete'

  // Get content for current slide
  const currentTab = SLIDE_TABS[activeSlideIndex]
  const slideContent = activeScorecard[currentTab.key as keyof typeof activeScorecard] as string | null

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border px-4 shrink-0">
        {SLIDE_TABS.map((tab, i) => (
          <button
            key={tab.key}
            onClick={() => setActiveSlide(i)}
            className={`px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              i === activeSlideIndex
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Slide content */}
      <div className="flex-1 overflow-y-auto p-5">
        {generating ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-text-tertiary">Generating scorecard...</p>
            <p className="text-[10px] text-text-tertiary opacity-60">This may take 15-30 seconds</p>
          </div>
        ) : !isComplete ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-sm text-text-tertiary">No scorecard generated yet</p>
            <p className="text-xs text-text-tertiary opacity-60">
              Add your materials on the left and click Generate
            </p>
          </div>
        ) : currentTab.key === 'slide_scorecard_table' ? (
          <ScorecardTable data={slideContent || '{}'} />
        ) : slideContent ? (
          <MarkdownRenderer content={slideContent} />
        ) : (
          <p className="text-xs text-text-tertiary text-center py-8">
            No content for this slide
          </p>
        )}
      </div>
    </div>
  )
}
