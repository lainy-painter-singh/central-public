import { RELATIONSHIP_COLORS, PRIORITY_CONFIG } from '../../lib/constants'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'priority' | 'relationship'
  priority?: string
  relationship?: string
  className?: string
}

export function Badge({ children, variant = 'default', priority, relationship, className = '' }: BadgeProps) {
  let colorClass = 'bg-neutral-800 text-neutral-400'

  if (variant === 'priority' && priority && priority in PRIORITY_CONFIG) {
    const config = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG]
    colorClass = `${config.bg} ${config.color}`
  } else if (variant === 'relationship' && relationship && relationship in RELATIONSHIP_COLORS) {
    colorClass = RELATIONSHIP_COLORS[relationship as keyof typeof RELATIONSHIP_COLORS]
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass} ${className}`}>
      {children}
    </span>
  )
}
