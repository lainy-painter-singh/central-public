import { create } from 'zustand'
import { CalendarEvent, getAPI } from '../lib/ipc'

interface CalendarStore {
  events: CalendarEvent[]          // today's events (backward compat)
  upcomingEvents: CalendarEvent[]  // today + upcoming days
  recentEvents: CalendarEvent[]    // past meetings (for Recent Meetings section)
  loading: boolean
  connected: boolean
  fetchToday: () => Promise<void>
  fetchUpcoming: (daysAhead?: number) => Promise<void>
  fetchRecent: (daysBack?: number) => Promise<void>
  checkConnection: () => Promise<void>
  connect: () => Promise<void>
}

export const useCalendarStore = create<CalendarStore>((set) => ({
  events: [],
  upcomingEvents: [],
  recentEvents: [],
  loading: false,
  connected: false,

  fetchToday: async () => {
    set({ loading: true })
    try {
      const events = await getAPI().calendar.getToday()
      set({ events, loading: false })
    } catch (err) {
      console.error('Failed to fetch calendar:', err)
      set({ loading: false })
    }
  },

  fetchUpcoming: async (daysAhead: number = 7) => {
    set({ loading: true })
    try {
      const allEvents = await getAPI().calendar.getUpcoming(daysAhead)
      // Also set today's events for backward compat
      const today = new Date().toISOString().split('T')[0]
      const todayEvents = allEvents.filter(e => e.date === today)
      set({ upcomingEvents: allEvents, events: todayEvents, loading: false })
    } catch (err) {
      console.error('Failed to fetch upcoming calendar:', err)
      set({ loading: false })
    }
  },

  fetchRecent: async (daysBack: number = 5) => {
    try {
      const recentEvents = await getAPI().calendar.getRecent(daysBack)
      set({ recentEvents })
    } catch (err) {
      console.error('Failed to fetch recent calendar:', err)
    }
  },

  checkConnection: async () => {
    const connected = await getAPI().calendar.isConnected()
    set({ connected })
  },

  connect: async () => {
    const result = await getAPI().calendar.connect()
    if (result.success) {
      set({ connected: true })
    }
  },
}))
