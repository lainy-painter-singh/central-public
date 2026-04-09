import { create } from 'zustand'
import { Todo, getAPI } from '../lib/ipc'

interface TodoStore {
  todos: Todo[]
  loading: boolean
  filter: { status?: string; type?: string; company_id?: string }
  fetch: () => Promise<void>
  fetchOpen: () => Promise<void>
  create: (todo: Partial<Todo>) => Promise<Todo>
  update: (id: string, updates: Partial<Todo>) => Promise<void>
  markDone: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  setFilter: (filter: TodoStore['filter']) => void
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  filter: {},

  fetch: async () => {
    set({ loading: true })
    try {
      const todos = await getAPI().todos.getAll(get().filter)
      set({ todos, loading: false })
    } catch (err) {
      console.error('Failed to fetch todos:', err)
      set({ loading: false })
    }
  },

  fetchOpen: async () => {
    set({ loading: true })
    try {
      const todos = await getAPI().todos.getOpen()
      set({ todos, loading: false })
    } catch (err) {
      console.error('Failed to fetch open todos:', err)
      set({ loading: false })
    }
  },

  create: async (todo) => {
    const newTodo = await getAPI().todos.create(todo)
    set(state => ({ todos: [newTodo, ...state.todos] }))
    return newTodo
  },

  update: async (id, updates) => {
    const updated = await getAPI().todos.update(id, updates)
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, ...updated } : t),
    }))
  },

  markDone: async (id) => {
    await getAPI().todos.markDone(id)
    set(state => ({
      todos: state.todos.map(t =>
        t.id === id ? { ...t, status: 'done', completed_at: new Date().toISOString() } : t
      ),
    }))
  },

  dismiss: async (id) => {
    await getAPI().todos.dismiss(id)
    set(state => ({
      todos: state.todos.filter(t => t.id !== id),
    }))
  },

  setFilter: (filter) => {
    set({ filter })
    get().fetch()
  },
}))
