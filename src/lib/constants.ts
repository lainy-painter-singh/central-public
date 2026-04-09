export const DEAL_CATEGORIES = [
  { id: 'active_diligence', label: 'Active Diligence', color: 'bg-accent' },
  { id: 'long_term', label: 'Long Term', color: 'bg-board-observer' },
  { id: 'first_meeting', label: 'First Meeting', color: 'bg-neutral-500' },
  { id: 'passed', label: 'Passed', color: 'bg-neutral-700' },
  { id: 'not_a_deal', label: 'Not a Deal', color: 'bg-neutral-800' },
] as const

export type DealCategory = (typeof DEAL_CATEGORIES)[number]['id']

export const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: 'text-urgent', bg: 'bg-urgent/10', order: 1 },
  high: { label: 'High', color: 'text-high', bg: 'bg-high/10', order: 2 },
  medium: { label: 'Med', color: 'text-medium', bg: 'bg-medium/10', order: 3 },
  low: { label: 'Low', color: 'text-low', bg: 'bg-low/10', order: 4 },
} as const

export type Priority = keyof typeof PRIORITY_CONFIG

export const TODO_TYPES = {
  deal_followup: { label: 'Deal', color: 'text-deal' },
  portfolio_followup: { label: 'Portfolio', color: 'text-board-seat' },
  board_prep: { label: 'Board Prep', color: 'text-board-seat' },
  board_summary: { label: 'Board Summary', color: 'text-board-seat' },
  glue_post: { label: 'Glue Post', color: 'text-purple-400' },
  internal: { label: 'Internal', color: 'text-text-tertiary' },
  manual: { label: 'Manual', color: 'text-text-secondary' },
} as const

export const RELATIONSHIP_COLORS = {
  board_seat: 'bg-board-seat/20 text-board-seat',
  board_observer: 'bg-board-observer/20 text-board-observer',
  deal: 'bg-deal/20 text-deal',
  other: 'bg-neutral-700 text-neutral-400',
} as const

export type View = 'today' | 'portfolio' | 'deals' | 'scorecard' | 'deal_sharing'
