import { useState } from 'react'
import { useTodoStore } from '../../stores/todoStore'
import { TodoItem } from './TodoItem'
import { TodoFilters } from './TodoFilters'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { EmptyState } from '../shared/EmptyState'

export function TodoList() {
  const { todos, create } = useTodoStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [newTodoTitle, setNewTodoTitle] = useState('')
  const [newTodoPriority, setNewTodoPriority] = useState('medium')
  const [showCompleted, setShowCompleted] = useState(false)

  const openTodos = todos.filter(t => t.status === 'open')
  const doneTodos = todos.filter(t => t.status === 'done')
  const displayTodos = showCompleted ? [...openTodos, ...doneTodos] : openTodos

  const handleAddTodo = async () => {
    if (!newTodoTitle.trim()) return
    await create({
      title: newTodoTitle.trim(),
      priority: newTodoPriority,
      type: 'manual',
      source: 'manual',
    })
    setNewTodoTitle('')
    setNewTodoPriority('medium')
    setShowAddModal(false)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Action Items</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {openTodos.length} open{doneTodos.length > 0 ? ` · ${doneTodos.length} completed` : ''}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          + Add
        </Button>
      </div>

      {/* Filters */}
      <TodoFilters showCompleted={showCompleted} onToggleCompleted={() => setShowCompleted(!showCompleted)} />

      {/* Todo List */}
      {displayTodos.length === 0 ? (
        <EmptyState
          icon="✓"
          title="All clear"
          description="No open action items. Sync meetings to generate new ones."
        />
      ) : (
        <div className="space-y-0.5">
          {displayTodos.map(todo => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </div>
      )}

      {/* Add Todo Modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="New Action Item">
        <div className="space-y-4">
          <div>
            <input
              type="text"
              value={newTodoTitle}
              onChange={e => setNewTodoTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTodo()}
              placeholder="What needs to be done?"
              autoFocus
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">Priority:</span>
            {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
              <button
                key={p}
                onClick={() => setNewTodoPriority(p)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  newTodoPriority === p
                    ? 'bg-accent/20 text-accent'
                    : 'bg-surface-hover text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleAddTodo} disabled={!newTodoTitle.trim()}>
              Add
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
