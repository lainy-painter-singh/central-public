import { format, isPast, isWithinInterval } from 'date-fns'
import type { CalendarEvent } from '../../lib/ipc'

interface MeetingCardProps {
  event: CalendarEvent
  showDate?: boolean
}

type MeetingStatus = 'past' | 'live' | 'upcoming'

function getMeetingStatus(event: CalendarEvent): MeetingStatus {
  const now = new Date()
  const start = new Date(event.start_time)
  const end = new Date(event.end_time)

  if (isPast(end)) return 'past'
  if (isWithinInterval(now, { start, end })) return 'live'
  return 'upcoming'
}

function formatTimeRange(event: CalendarEvent): string {
  try {
    const start = new Date(event.start_time)
    const end = new Date(event.end_time)
    return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`
  } catch {
    return ''
  }
}

function getAttendeeNames(event: CalendarEvent): string[] {
  try {
    const attendees = event.attendees ? JSON.parse(event.attendees) : []
    return attendees
      .filter((a: any) => !a.self)
      .map((a: any) => {
        const name = a.name || a.email || ''
        // Use first name only for cleaner display
        if (name.includes('@')) return name.split('@')[0]
        return name.split(' ')[0]
      })
      .filter(Boolean)
      .slice(0, 4)
  } catch {
    return []
  }
}

export function MeetingCard({ event, showDate }: MeetingCardProps) {
  const status = getMeetingStatus(event)
  const timeRange = formatTimeRange(event)
  const names = getAttendeeNames(event)
  const totalAttendees = event.attendees ? JSON.parse(event.attendees).filter((a: any) => !a.self).length : 0

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
        status === 'past'
          ? 'opacity-40'
          : status === 'live'
          ? 'bg-accent/5'
          : 'hover:bg-surface-hover'
      }`}
    >
      {/* Live indicator dot */}
      <div className="w-2 flex-shrink-0 flex justify-center">
        {status === 'live' && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        )}
      </div>

      {/* Time */}
      <div className="w-32 flex-shrink-0">
        <span className={`text-xs tabular-nums ${
          status === 'live' ? 'text-text-primary font-medium' : 'text-text-tertiary'
        }`}>
          {timeRange}
        </span>
        {showDate && (
          <span className="text-[10px] text-text-tertiary block mt-0.5">
            {format(new Date(event.start_time), 'EEE, MMM d')}
          </span>
        )}
      </div>

      {/* Title + attendees */}
      <div className="flex-1 min-w-0">
        <h3 className={`text-sm truncate ${
          status === 'live'
            ? 'font-medium text-text-primary'
            : status === 'past'
            ? 'text-text-secondary'
            : 'text-text-primary'
        }`}>
          {event.title}
        </h3>
        {names.length > 0 && (
          <p className="text-xs text-text-tertiary mt-0.5 truncate">
            {names.join(', ')}
            {totalAttendees > names.length ? ` +${totalAttendees - names.length}` : ''}
          </p>
        )}
      </div>

      {/* Company badge */}
      {event.company_name && (
        <span className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ${
          event.relationship === 'portfolio'
            ? 'bg-blue-500/10 text-blue-400'
            : event.relationship === 'prospect'
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-surface-hover text-text-tertiary'
        }`}>
          {event.company_name}
        </span>
      )}

      {/* Join button for live/upcoming with meeting link */}
      {event.meeting_link && status !== 'past' && (
        <a
          href={event.meeting_link}
          className={`text-xs px-2.5 py-1 rounded-md flex-shrink-0 transition-colors ${
            status === 'live'
              ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 font-medium'
              : 'text-accent hover:text-accent-hover hover:bg-accent/10'
          }`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Join
        </a>
      )}
    </div>
  )
}
