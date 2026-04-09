import { useState, useEffect, useRef } from 'react'
import type { View } from '../../lib/constants'
import { useDealStore } from '../../stores/dealStore'
import { useTodoStore } from '../../stores/todoStore'

interface CommandBarProps {
  onClose: () => void
  onNavigate: (view: View) => void
}

interface Command {
  id: string
  label: string
  category: string
  action: () => void
}

export function CommandBar({ onClose, onNavigate }: CommandBarProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const createDeal = useDealStore(s => s.create)
  const createTodo = useTodoStore(s => s.create)

  const commands: Command[] = [
    { id: 'nav-today', label: 'Go to Today', category: 'Navigate', action: () => onNavigate('today') },
    { id: 'nav-portfolio', label: 'Go to Portfolio', category: 'Navigate', action: () => onNavigate('portfolio') },
    { id: 'nav-deals', label: 'Go to Live Deals', category: 'Navigate', action: () => onNavigate('deals') },
    {
      id: 'add-deal',
      label: 'Add New Deal',
      category: 'Actions',
      action: () => {
        onNavigate('deals')
        onClose()
      },
    },
    {
      id: 'add-todo',
      label: 'Add Action Item',
      category: 'Actions',
      action: () => {
        onNavigate('today')
        onClose()
      },
    },
    {
      id: 'sync-granola',
      label: 'Sync Granola Meetings',
      category: 'Sync',
      action: () => {
        // Trigger granola sync
        onClose()
      },
    },
  ]

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action()
          onClose()
        }
        break
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[520px] bg-surface-raised border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          className="w-full px-5 py-4 bg-transparent text-text-primary text-base placeholder-text-tertiary outline-none border-b border-border"
        />
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-text-tertiary text-sm">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action()
                  onClose()
                }}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <span className="text-xs text-text-tertiary w-16">{cmd.category}</span>
                <span>{cmd.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
