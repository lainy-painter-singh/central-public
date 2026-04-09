import { create } from 'zustand'
import { Meeting, getAPI } from '../lib/ipc'

interface MeetingStore {
  meetings: Meeting[]
  loading: boolean
  syncing: boolean
  fetchRecent: (days?: number) => Promise<void>
  syncGranola: () => Promise<void>
  syncFellow: () => Promise<void>
}

export const useMeetingStore = create<MeetingStore>((set) => ({
  meetings: [],
  loading: false,
  syncing: false,

  fetchRecent: async (days = 7) => {
    set({ loading: true })
    try {
      const meetings = await getAPI().meetings.getRecent(days)
      set({ meetings, loading: false })
    } catch (err) {
      console.error('Failed to fetch meetings:', err)
      set({ loading: false })
    }
  },

  syncGranola: async () => {
    set({ syncing: true })
    try {
      await getAPI().meetings.syncGranola()
      // Refresh the list after sync
      const meetings = await getAPI().meetings.getRecent(7)
      set({ meetings, syncing: false })
    } catch (err) {
      console.error('Failed to sync Granola:', err)
      set({ syncing: false })
    }
  },

  syncFellow: async () => {
    set({ syncing: true })
    try {
      await getAPI().meetings.syncFellow()
      const meetings = await getAPI().meetings.getRecent(7)
      set({ meetings, syncing: false })
    } catch (err) {
      console.error('Failed to sync Fellow:', err)
      set({ syncing: false })
    }
  },
}))
