import { useState, useEffect } from 'react'
import { Shell } from './components/layout/Shell'
import { Sidebar } from './components/layout/Sidebar'
import { TodayView } from './components/today/TodayView'
import { LiveDealsView } from './components/deals/LiveDealsView'
import { PortfolioView } from './components/portfolio/PortfolioView'
import { ScorecardView } from './components/scorecard/ScorecardView'
import { DealSharingView } from './components/deals/DealSharingView'
import { CommandBar } from './components/layout/CommandBar'
import { useDealStore } from './stores/dealStore'
import { useTodoStore } from './stores/todoStore'
import { useMeetingStore } from './stores/meetingStore'
import type { View } from './lib/constants'

export default function App() {
  const [currentView, setCurrentView] = useState<View>('today')
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const fetchDeals = useDealStore(s => s.fetch)
  const fetchTodos = useTodoStore(s => s.fetchOpen)
  const fetchMeetings = useMeetingStore(s => s.fetchRecent)
  const syncGranola = useMeetingStore(s => s.syncGranola)

  // Initial data load
  useEffect(() => {
    fetchDeals()
    fetchTodos()
    syncGranola().then(() => fetchMeetings())
  }, [])

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandBarOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const renderView = () => {
    switch (currentView) {
      case 'today':
        return <TodayView onViewChange={setCurrentView} />
      case 'portfolio':
        return <PortfolioView />
      case 'deals':
        return <LiveDealsView onViewChange={setCurrentView} />
      case 'scorecard':
        return <ScorecardView onViewChange={setCurrentView} />
      case 'deal_sharing':
        return <DealSharingView />
      default:
        return <TodayView />
    }
  }

  return (
    <Shell>
      <div className="flex h-screen">
        <Sidebar currentView={currentView} onViewChange={setCurrentView} />
        <main className="flex-1 overflow-y-auto">
          {renderView()}
        </main>
      </div>
      {commandBarOpen && (
        <CommandBar
          onClose={() => setCommandBarOpen(false)}
          onNavigate={(view) => {
            setCurrentView(view)
            setCommandBarOpen(false)
          }}
        />
      )}
    </Shell>
  )
}
