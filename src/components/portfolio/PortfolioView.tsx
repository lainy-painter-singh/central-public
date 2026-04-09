import { useState, useEffect } from 'react'
import { useTodoStore } from '../../stores/todoStore'
import { Badge } from '../shared/Badge'
import { Button } from '../shared/Button'
import { EmptyState } from '../shared/EmptyState'
import { BoardPrepCard } from './BoardPrepCard'
import { PRIORITY_CONFIG, TODO_TYPES, RELATIONSHIP_COLORS } from '../../lib/constants'
import type { Company, Todo } from '../../lib/ipc'
import { getAPI } from '../../lib/ipc'

export function PortfolioView() {
  const { todos, fetchOpen, markDone, dismiss } = useTodoStore()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'board_seat' | 'board_observer'>('all')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    loadCompanies()
    fetchOpen()
  }, [])

  const loadCompanies = async () => {
    setLoading(true)
    try {
      const all = await getAPI().companies.getAll()
      // Only portfolio companies (board_seat + board_observer)
      const portfolio = all.filter((c: Company) => c.relationship === 'board_seat' || c.relationship === 'board_observer')
      setCompanies(portfolio)
      // Auto-expand companies with open todos
      const withTodos = new Set<string>()
      portfolio.forEach((c: Company) => {
        const companyTodos = todos.filter(t => t.company_id === c.id && t.status === 'open')
        if (companyTodos.length > 0) withTodos.add(c.id)
      })
      setExpandedCompanies(withTodos)
    } catch (err) {
      console.error('Failed to load companies:', err)
    }
    setLoading(false)
  }

  const handleScanBoardMeetings = async () => {
    setScanning(true)
    try {
      const result = await getAPI().boardPrep.detectBoardMeetings()
      if (result.success) {
        // Refresh todos to show newly created ones
        fetchOpen()
      }
    } catch (err) {
      console.error('Board detection failed:', err)
    }
    setScanning(false)
  }

  const filteredCompanies = companies.filter(c => {
    if (filter === 'all') return true
    return c.relationship === filter
  })

  // Group: board seats first, then observers
  const boardSeats = filteredCompanies.filter(c => c.relationship === 'board_seat')
  const boardObservers = filteredCompanies.filter(c => c.relationship === 'board_observer')

  const toggleCompany = (id: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getCompanyTodos = (companyId: string) => {
    return todos.filter(t => t.company_id === companyId && t.status === 'open')
  }

  const totalOpenTodos = todos.filter(t => {
    const isPortfolio = companies.some(c => c.id === t.company_id)
    return isPortfolio && t.status === 'open'
  }).length

  const renderCompanyGroup = (title: string, groupCompanies: Company[], relationship: string) => {
    if (groupCompanies.length === 0) return null

    return (
      <section key={relationship} className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${relationship === 'board_seat' ? 'bg-board-seat' : 'bg-board-observer'}`} />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {title}
          </h2>
          <span className="text-xs text-text-tertiary tabular-nums">{groupCompanies.length}</span>
        </div>

        <div className="space-y-1">
          {groupCompanies.map(company => {
            const companyTodos = getCompanyTodos(company.id)
            const isExpanded = expandedCompanies.has(company.id)

            return (
              <div key={company.id} className="rounded-lg border border-border-subtle bg-surface-raised overflow-hidden">
                {/* Company Header */}
                <button
                  onClick={() => toggleCompany(company.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors"
                >
                  <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                    ▸
                  </span>

                  {/* Company Name */}
                  <h3 className="text-sm font-medium text-text-primary flex-1 text-left">
                    {company.name}
                  </h3>

                  {/* Todo count */}
                  {companyTodos.length > 0 && (
                    <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full tabular-nums">
                      {companyTodos.length} {companyTodos.length === 1 ? 'todo' : 'todos'}
                    </span>
                  )}

                  <Badge variant="relationship" relationship={company.relationship}>
                    {company.relationship === 'board_seat' ? 'Board' : 'Observer'}
                  </Badge>
                </button>

                {/* Expanded: Todos + Board Prep */}
                {isExpanded && (
                  <div>
                    {/* Todos */}
                    <div className="border-t border-border-subtle">
                      {companyTodos.length === 0 ? (
                        <div className="px-4 py-3 text-center">
                          <p className="text-xs text-text-tertiary">No open action items</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border-subtle">
                          {companyTodos.map(todo => {
                            const priorityConfig = PRIORITY_CONFIG[todo.priority as keyof typeof PRIORITY_CONFIG]
                            const typeConfig = TODO_TYPES[todo.type as keyof typeof TODO_TYPES]

                            return (
                              <div
                                key={todo.id}
                                className="group flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors"
                              >
                                {/* Checkbox */}
                                <button
                                  onClick={() => markDone(todo.id)}
                                  className="mt-0.5 w-4 h-4 rounded-full border border-text-tertiary hover:border-success hover:bg-success/10 flex-shrink-0 transition-colors"
                                />

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-text-primary">{todo.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {typeConfig && (
                                      <span className={`text-xs ${typeConfig.color}`}>{typeConfig.label}</span>
                                    )}
                                    {todo.source_meeting_title && (
                                      <span className="text-xs text-text-tertiary truncate">
                                        from: {todo.source_meeting_title}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Priority + Dismiss */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {priorityConfig && (
                                    <Badge variant="priority" priority={todo.priority}>
                                      {priorityConfig.label}
                                    </Badge>
                                  )}
                                  <button
                                    onClick={() => dismiss(todo.id)}
                                    className="opacity-0 group-hover:opacity-100 text-xs text-text-tertiary hover:text-urgent transition-all"
                                    title="Dismiss"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Board Prep */}
                    <BoardPrepCard companyId={company.id} companyName={company.name} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Portfolio</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {companies.length} companies · {totalOpenTodos} open todos
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Scan Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleScanBoardMeetings}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Scan Board Meetings'}
          </Button>

        {/* Filter */}
        <div className="flex gap-1">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'board_seat' as const, label: 'Board Seats' },
            { id: 'board_observer' as const, label: 'Observers' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-sm text-text-tertiary">Loading portfolio...</p>
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          icon="◈"
          title="No portfolio companies"
          description="Portfolio companies will appear here once seeded."
        />
      ) : (
        <div>
          {renderCompanyGroup('Board Seats', boardSeats, 'board_seat')}
          {renderCompanyGroup('Board Observers', boardObservers, 'board_observer')}
        </div>
      )}
    </div>
  )
}
