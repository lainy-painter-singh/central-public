interface TodoFiltersProps {
  showCompleted: boolean
  onToggleCompleted: () => void
}

export function TodoFilters({ showCompleted, onToggleCompleted }: TodoFiltersProps) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={onToggleCompleted}
        className={`text-xs px-2 py-1 rounded transition-colors ${
          showCompleted
            ? 'bg-surface-hover text-text-primary'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        {showCompleted ? 'Hide completed' : 'Show completed'}
      </button>
    </div>
  )
}
