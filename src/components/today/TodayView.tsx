import { useEffect, useState, useRef, useMemo } from 'react'
import { format, isTomorrow, isPast, addMinutes } from 'date-fns'
import { useCalendarStore } from '../../stores/calendarStore'
import { useTodoStore } from '../../stores/todoStore'
import { MeetingCard } from './MeetingCard'
import { Badge } from '../shared/Badge'
import { Button } from '../shared/Button'
import { PRIORITY_CONFIG } from '../../lib/constants'
import { Company, getAPI } from '../../lib/ipc'
import type { CalendarEvent } from '../../lib/ipc'

function AddTodoInput() {
  const [isAdding, setIsAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [companySearch, setCompanySearch] = useState('')
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const [priority, setPriority] = useState<string>('medium')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getAPI().companies.getAll().then(setCompanies)
  }, [])

  useEffect(() => {
    if (isAdding && titleRef.current) {
      titleRef.current.focus()
    }
  }, [isAdding])

  const filteredCompanies = companySearch.length > 0
    ? companies.filter(c =>
        c.name.toLowerCase().includes(companySearch.toLowerCase())
      ).slice(0, 6)
    : []

  const handleSubmit = async () => {
    if (!title.trim()) return

    await useTodoStore.getState().create({
      title: title.trim(),
      company_id: selectedCompany?.id || null,
      type: 'manual',
      priority,
      source: 'manual',
    })

    setTitle('')
    setCompanySearch('')
    setSelectedCompany(null)
    setPriority('medium')
    setIsAdding(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setIsAdding(false)
      setTitle('')
      setCompanySearch('')
      setSelectedCompany(null)
    }
  }

  if (!isAdding) {
    return (
      <button
        onClick={() => setIsAdding(true)}
        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary hover:bg-surface-hover rounded-lg border border-dashed border-border-subtle transition-colors"
      >
        <span className="text-base">+</span>
        <span>Add action item</span>
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-surface-raised p-3 space-y-2">
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What do you need to do?"
        className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
      />

      <div className="flex items-center gap-2">
        {/* Company picker */}
        <div className="relative flex-1">
          {selectedCompany ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary">
              <span>{selectedCompany.name}</span>
              <button
                onClick={() => {
                  setSelectedCompany(null)
                  setCompanySearch('')
                }}
                className="text-text-tertiary hover:text-text-primary"
              >
                ×
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={companySearch}
              onChange={e => {
                setCompanySearch(e.target.value)
                setShowCompanyDropdown(true)
              }}
              onFocus={() => setShowCompanyDropdown(true)}
              onBlur={() => setTimeout(() => setShowCompanyDropdown(false), 150)}
              onKeyDown={handleKeyDown}
              placeholder="Company (optional)"
              className="w-full bg-transparent text-xs text-text-secondary placeholder:text-text-tertiary outline-none"
            />
          )}

          {showCompanyDropdown && filteredCompanies.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-48 bg-surface-raised border border-border rounded-md shadow-lg z-10 py-1">
              {filteredCompanies.map(c => (
                <button
                  key={c.id}
                  onMouseDown={() => {
                    setSelectedCompany(c)
                    setCompanySearch('')
                    setShowCompanyDropdown(false)
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority selector */}
        <div className="flex items-center gap-0.5">
          {(['high', 'medium', 'low'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                priority === p
                  ? `${PRIORITY_CONFIG[p].bg} ${PRIORITY_CONFIG[p].color}`
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {PRIORITY_CONFIG[p].label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button
          onClick={() => {
            setIsAdding(false)
            setTitle('')
            setCompanySearch('')
            setSelectedCompany(null)
          }}
          className="text-xs text-text-tertiary hover:text-text-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="text-xs text-accent hover:text-accent-hover disabled:opacity-30 disabled:cursor-not-allowed font-medium"
        >
          Add
        </button>
      </div>
    </div>
  )
}

/**
 * Granola-style "Your Day" logic:
 * - Shows today's events during the day
 * - Once all today's meetings are over, switches to the next day that has meetings
 * - Groups events by date and picks the "active" day
 */
function useActiveDay(allEvents: CalendarEvent[]) {
  const [now, setNow] = useState(new Date())

  // Refresh every minute to update live status and day switching
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])

  return useMemo(() => {
    if (allEvents.length === 0) {
      return { activeDate: null, activeDateEvents: [], label: 'No upcoming meetings' }
    }

    // Group events by date string
    const byDate = new Map<string, CalendarEvent[]>()
    for (const e of allEvents) {
      const d = e.date
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(e)
    }

    const todayStr = format(now, 'yyyy-MM-dd')
    const sortedDates = Array.from(byDate.keys()).sort()

    // Check if today has remaining (not-yet-ended) meetings
    const todayEvents = byDate.get(todayStr) || []
    const todayHasRemaining = todayEvents.some(e => {
      try {
        // Event hasn't ended yet (add 5 min buffer for meetings that just ended)
        return !isPast(addMinutes(new Date(e.end_time), 5))
      } catch {
        return false
      }
    })

    // If today has remaining meetings, show today
    if (todayHasRemaining && todayEvents.length > 0) {
      return {
        activeDate: todayStr,
        activeDateEvents: todayEvents,
        label: 'Today',
      }
    }

    // Otherwise, find the next day with meetings
    for (const dateStr of sortedDates) {
      if (dateStr <= todayStr) continue
      const events = byDate.get(dateStr)!
      if (events.length > 0) {
        const dateObj = new Date(dateStr + 'T12:00:00')
        let label: string
        if (isTomorrow(dateObj)) {
          label = 'Tomorrow'
        } else {
          label = format(dateObj, 'EEEE, MMMM d')
        }
        return {
          activeDate: dateStr,
          activeDateEvents: events,
          label,
        }
      }
    }

    // If today has events (all past) and nothing upcoming, still show today
    if (todayEvents.length > 0) {
      return {
        activeDate: todayStr,
        activeDateEvents: todayEvents,
        label: 'Today',
      }
    }

    return { activeDate: null, activeDateEvents: [], label: 'No upcoming meetings' }
  }, [allEvents, now])
}

export function TodayView({ onViewChange }: { onViewChange?: (view: string) => void }) {
  const { upcomingEvents, recentEvents, fetchUpcoming, fetchRecent, connected } = useCalendarStore()
  const { todos } = useTodoStore()

  const openTodos = todos.filter(t => t.status === 'open')

  // Group recent events by date, exclude today (today is in "Your Day")
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const pastEvents = recentEvents.filter(e => e.date < todayStr)

  useEffect(() => {
    if (connected) {
      fetchUpcoming(7)
      fetchRecent(5)
    }
  }, [connected])

  // Re-fetch when main process finishes calendar sync (startup race condition)
  useEffect(() => {
    const cleanup = getAPI().calendar.onSynced(() => {
      fetchUpcoming(7)
    })
    return cleanup
  }, [])

  const today = new Date()
  const { activeDateEvents, label: dayLabel } = useActiveDay(upcomingEvents)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          {format(today, 'EEEE, MMMM d')}
        </h1>
        <p className="text-sm text-text-tertiary mt-1">
          {today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening'}
        </p>
      </div>

      {/* Your Day — Granola-style */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Your Day
            </h2>
            {dayLabel !== 'Today' && dayLabel !== 'No upcoming meetings' && (
              <span className="text-xs text-text-tertiary">
                · {dayLabel}
              </span>
            )}
          </div>
          {activeDateEvents.length > 0 && (
            <span className="text-xs text-text-tertiary tabular-nums">
              {activeDateEvents.length} meeting{activeDateEvents.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {!connected ? (
          <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
            <p className="text-sm text-text-secondary mb-3">
              Connect Google Calendar to see your schedule
            </p>
            <Button variant="primary" size="sm" onClick={() => useCalendarStore.getState().connect()}>
              Connect Calendar
            </Button>
          </div>
        ) : activeDateEvents.length === 0 ? (
          <div className="rounded-lg border border-border-subtle bg-surface-raised p-6 text-center">
            <p className="text-sm text-text-tertiary">No upcoming meetings</p>
            <p className="text-xs text-text-tertiary mt-1">Enjoy the free time</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border-subtle bg-surface-raised divide-y divide-border-subtle overflow-hidden">
            {activeDateEvents.map(event => (
              <MeetingCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>

      {/* Action Items */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Action Items
          </h2>
          {openTodos.length > 0 && (
            <span className="text-xs text-text-tertiary">
              {openTodos.length} open
            </span>
          )}
        </div>

        <div className="space-y-1">
          {openTodos.length > 0 && (
            <div className="rounded-lg border border-border-subtle bg-surface-raised divide-y divide-border-subtle">
              {openTodos.map(todo => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors"
                >
                  <button
                    onClick={() => useTodoStore.getState().markDone(todo.id)}
                    className="w-4 h-4 rounded-full border border-text-tertiary hover:border-success hover:bg-success/20 transition-colors flex-shrink-0"
                  />
                  <input
                    className="flex-1 text-sm text-text-primary bg-transparent min-w-0 truncate outline-none focus:bg-surface focus:rounded focus:px-1.5 focus:py-0.5 focus:-my-0.5 focus:ring-1 focus:ring-accent/50 cursor-text"
                    defaultValue={todo.title}
                    key={todo.id + '-' + todo.title}
                    onBlur={e => {
                      const val = e.currentTarget.value.trim()
                      if (val && val !== todo.title) {
                        useTodoStore.getState().update(todo.id, { title: val })
                      } else if (!val) {
                        e.currentTarget.value = todo.title
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        e.currentTarget.value = todo.title
                        e.currentTarget.blur()
                      }
                    }}
                  />
                  {todo.company_name && (
                    <button
                      onClick={() => onViewChange?.('deals')}
                      className="text-xs text-text-tertiary hover:text-text-primary hover:underline transition-colors"
                    >
                      {todo.company_name}
                    </button>
                  )}
                  <Badge variant="priority" priority={todo.priority}>
                    {PRIORITY_CONFIG[todo.priority as keyof typeof PRIORITY_CONFIG]?.label || todo.priority}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <AddTodoInput />
        </div>
      </section>

      {/* Recent Meetings */}
      {connected && pastEvents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Recent Meetings
            </h2>
            <span className="text-xs text-text-tertiary tabular-nums">
              {pastEvents.length} meeting{pastEvents.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-raised divide-y divide-border-subtle overflow-hidden">
            {pastEvents.map(event => (
              <div key={event.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors">
                <span className="text-xs text-text-tertiary w-14 flex-shrink-0 tabular-nums">
                  {format(new Date(event.date + 'T12:00:00'), 'EEE d')}
                </span>
                <span className="flex-1 text-sm text-text-primary truncate">{event.title}</span>
                {event.company_name && (
                  <span className="text-xs text-text-tertiary truncate max-w-[120px]">{event.company_name}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
