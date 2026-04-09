import { Badge } from '../shared/Badge'
import { useTodoStore } from '../../stores/todoStore'
import { PRIORITY_CONFIG, TODO_TYPES } from '../../lib/constants'
import type { Todo } from '../../lib/ipc'

interface TodoItemProps {
  todo: Todo
}

export function TodoItem({ todo }: TodoItemProps) {
  const { markDone, dismiss } = useTodoStore()
  const isDone = todo.status === 'done'
  const priorityConfig = PRIORITY_CONFIG[todo.priority as keyof typeof PRIORITY_CONFIG]
  const typeConfig = TODO_TYPES[todo.type as keyof typeof TODO_TYPES]

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 rounded-lg hover:bg-surface-hover transition-colors ${
        isDone ? 'opacity-50' : ''
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={() => !isDone && markDone(todo.id)}
        className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 transition-colors flex items-center justify-center ${
          isDone
            ? 'bg-success/20 border-success text-success'
            : 'border-text-tertiary hover:border-success hover:bg-success/10'
        }`}
      >
        {isDone && <span className="text-[10px]">✓</span>}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isDone ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
          {todo.title}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {todo.company_name && (
            <span className="text-xs text-text-tertiary">{todo.company_name}</span>
          )}
          {todo.source_meeting_title && (
            <span className="text-xs text-text-tertiary">
              from: {todo.source_meeting_title}
            </span>
          )}
          {todo.deadline && (
            <span className="text-xs text-text-tertiary">Due: {todo.deadline}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {typeConfig && (
          <span className={`text-xs ${typeConfig.color}`}>{typeConfig.label}</span>
        )}
        {priorityConfig && !isDone && (
          <Badge variant="priority" priority={todo.priority}>
            {priorityConfig.label}
          </Badge>
        )}
        {/* Dismiss button (hidden until hover) */}
        {!isDone && (
          <button
            onClick={() => dismiss(todo.id)}
            className="opacity-0 group-hover:opacity-100 text-xs text-text-tertiary hover:text-urgent transition-all"
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
