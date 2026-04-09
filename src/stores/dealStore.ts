import { create } from 'zustand'
import { Deal, getAPI } from '../lib/ipc'

interface DealStore {
  deals: Deal[]
  loading: boolean
  selectedDealId: string | null
  fetch: () => Promise<void>
  create: (deal: Partial<Deal> & { company_name?: string }) => Promise<Deal>
  updateCategory: (id: string, category: string) => Promise<void>
  update: (id: string, updates: Partial<Deal>) => Promise<void>
  remove: (id: string) => Promise<void>
  selectDeal: (id: string | null) => void
}

export const useDealStore = create<DealStore>((set, get) => ({
  deals: [],
  loading: false,
  selectedDealId: null,

  fetch: async () => {
    set({ loading: true })
    try {
      const deals = await getAPI().deals.getAll()
      set({ deals, loading: false })
    } catch (err) {
      console.error('Failed to fetch deals:', err)
      set({ loading: false })
    }
  },

  create: async (deal) => {
    const newDeal = await getAPI().deals.create(deal)
    set(state => ({ deals: [newDeal, ...state.deals] }))
    return newDeal
  },

  updateCategory: async (id, category) => {
    const updated = await getAPI().deals.updateCategory(id, category)
    set(state => ({
      deals: state.deals.map(d => (d.id === id ? updated : d)),
    }))
  },

  update: async (id, updates) => {
    const updated = await getAPI().deals.update(id, updates)
    if (updated) {
      set(state => ({
        deals: state.deals.map(d => (d.id === id ? updated : d)),
      }))
    }
  },

  remove: async (id) => {
    await getAPI().deals.delete(id)
    set(state => ({
      deals: state.deals.filter(d => d.id !== id),
      selectedDealId: state.selectedDealId === id ? null : state.selectedDealId,
    }))
  },

  selectDeal: (id) => set({ selectedDealId: id }),
}))
