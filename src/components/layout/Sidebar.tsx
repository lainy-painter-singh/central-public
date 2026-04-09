import { useEffect, useState } from 'react'
import type { View } from '../../lib/constants'
import { useTodoStore } from '../../stores/todoStore'
import { useDealStore } from '../../stores/dealStore'
import { useCalendarStore } from '../../stores/calendarStore'
import { getAPI } from '../../lib/ipc'

interface SidebarProps {
  currentView: View
  onViewChange: (view: View) => void
}

const NAV_ITEMS: { id: View; label: string; shortcut: string; icon: string }[] = [
  { id: 'today', label: 'Today', shortcut: '1', icon: '◐' },
  { id: 'portfolio', label: 'Portfolio', shortcut: '2', icon: '◈' },
  { id: 'deals', label: 'Live Deals', shortcut: '3', icon: '◫' },
  { id: 'scorecard', label: 'Scorecard', shortcut: '4', icon: '◧' },
  { id: 'deal_sharing', label: 'Deal Sharing', shortcut: '5', icon: '◇' },
]

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const openTodoCount = useTodoStore(s => s.todos.filter(t => t.status === 'open').length)
  const activeDealCount = useDealStore(s => s.deals.filter(d => d.category !== 'passed' && d.category !== 'not_a_deal').length)
  const { connected: googleConnected, checkConnection, connect: connectGoogle } = useCalendarStore()

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  const handleConnectGoogle = async () => {
    await connectGoogle()
  }

  return (
    <nav className="w-52 h-full bg-surface border-r border-border flex flex-col py-4 titlebar-no-drag">
      <div className="px-4 mb-6">
        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: true,
            })
            window.dispatchEvent(event)
          }}
          className="w-full text-left px-3 py-1.5 rounded-md text-sm text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-colors"
        >
          Search... <span className="text-xs opacity-50">⌘K</span>
        </button>
      </div>

      <div className="flex-1 px-2 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const isActive = currentView === item.id
          const count = item.id === 'today' ? openTodoCount :
                        item.id === 'deals' ? activeDealCount : null

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-surface-hover text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <span className="text-base opacity-60">{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {count !== null && count > 0 && (
                <span className="text-xs text-text-tertiary tabular-nums">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="shrink-0 px-4 pt-4 pb-2 border-t border-border-subtle space-y-3">
        <div className="text-xs text-text-tertiary space-y-1">
          <div className="flex justify-between">
            <span>Granola</span>
            <span className="text-success">synced</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Google</span>
            {googleConnected ? (
              <span className="text-success">connected</span>
            ) : (
              <button
                onClick={handleConnectGoogle}
                className="text-accent hover:text-accent-hover transition-colors"
              >
                connect
              </button>
            )}
          </div>
          <div className="flex justify-between">
            <span>Obsidian Vault</span>
            <span className="text-success">linked</span>
          </div>
        </div>
        <SyncButton />
      </div>
    </nav>
  )
}

function SyncButton() {
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncStatus('Syncing Granola, Fellow, Calendar...')
    try {
      await getAPI().sync.forceSync()
      setSyncStatus('Synced + exported to Obsidian')
      setTimeout(() => setSyncStatus(null), 3000)
    } catch {
      setSyncStatus('Sync failed')
      setTimeout(() => setSyncStatus(null), 3000)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="w-full px-3 py-1.5 rounded-md text-xs text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
      >
        {syncing ? 'Syncing...' : 'Sync All + Obsidian'}
      </button>
      {syncStatus && (
        <p className="text-[10px] text-center text-text-tertiary">{syncStatus}</p>
      )}
    </div>
  )
}
