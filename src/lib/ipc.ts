// Typed wrapper around the Central IPC API exposed via preload

export interface Deal {
  id: string
  company_id: string
  company_name: string
  relationship: string
  stage: string
  category: string  // 'active_diligence' | 'long_term' | 'first_meeting' | 'passed'
  source: string | null
  notes: string | null
  description: string | null
  revenue: string | null
  round_size: string | null
  pass_reason: string | null
  pass_note: string | null
  contact_name: string | null
  contact_email: string | null
  moved_at: string
  created_at: string
  updated_at: string
}

export interface Todo {
  id: string
  title: string
  company_id: string | null
  company_name: string | null
  type: string
  priority: string
  status: string
  source: string | null
  source_meeting_id: string | null
  source_meeting_title: string | null
  deadline: string | null
  context: string | null
  created_at: string
  completed_at: string | null
}

export interface Meeting {
  id: string
  source: string
  title: string
  date: string
  attendees: string
  company_id: string | null
  company_name: string | null
  summary: string | null
  todos_extracted: number
  created_at: string
}

export interface CalendarEvent {
  id: string
  title: string
  start_time: string
  end_time: string
  attendees: string
  location: string | null
  meeting_link: string | null
  company_id: string | null
  company_name: string | null
  relationship: string | null
  date: string
}

export interface Company {
  id: string
  name: string
  relationship: string
  domain: string | null
}

export interface BoardPrep {
  id: string
  company_id: string
  company_name?: string
  meeting_date: string | null
  deck_source: string | null
  deck_path: string | null
  questions: string // JSON string of BoardQuestion[]
  summary_draft: string | null
  summary_final: string | null
  glue_posted: number
  created_at: string
}

export interface BoardQuestion {
  theme: string      // 'Financial' | 'Product' | 'GTM' | 'Team' | 'Strategy'
  question: string
  checked: boolean
}

export interface Scorecard {
  id: string
  deal_id: string
  company_id: string
  company_name?: string
  status: string  // 'draft' | 'generating' | 'complete' | 'error'
  deal_context: string | null
  meeting_ids: string  // JSON array
  file_contents: string  // JSON array
  additional_notes: string | null
  slide_executive_summary: string | null
  slide_highlights_risks: string | null
  slide_scorecard_table: string | null
  slide_hypothesis_framework: string | null
  model_used: string
  tokens_used: number | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// Access the API exposed by preload
export function getAPI() {
  return (window as any).central as {
    deals: {
      getAll: () => Promise<Deal[]>
      getByCategory: (category: string) => Promise<Deal[]>
      create: (deal: Partial<Deal> & { company_name?: string }) => Promise<Deal>
      update: (id: string, updates: Partial<Deal>) => Promise<Deal>
      updateCategory: (id: string, category: string) => Promise<Deal>
      delete: (id: string) => Promise<{ success: boolean }>
      getLinkedMeetings: (companyId: string, companyName: string) => Promise<any[]>
      getCompanyContacts: (companyId: string) => Promise<any[]>
      enrich: (companyId: string, companyName: string) => Promise<any>
      generateOverview: (companyId: string, companyName: string) => Promise<{ success: boolean; overview?: any; error?: string }>
      getCachedOverview: (companyId: string) => Promise<any>
    }
    todos: {
      getAll: (filters?: { status?: string; type?: string; company_id?: string }) => Promise<Todo[]>
      getOpen: () => Promise<Todo[]>
      getByCompany: (companyId: string) => Promise<Todo[]>
      create: (todo: Partial<Todo>) => Promise<Todo>
      update: (id: string, updates: Partial<Todo>) => Promise<Todo>
      markDone: (id: string) => Promise<{ success: boolean }>
      dismiss: (id: string) => Promise<{ success: boolean }>
    }
    companies: {
      getAll: () => Promise<Company[]>
      getByRelationship: (rel: string) => Promise<Company[]>
      rename: (companyId: string, newName: string) => Promise<Company>
    }
    meetings: {
      syncGranola: () => Promise<{ success: boolean; count?: number }>
      syncFellow: () => Promise<{ success: boolean }>
      getRecent: (days?: number) => Promise<Meeting[]>
      generateTodos: (meetingId: string) => Promise<{ success: boolean }>
    }
    calendar: {
      getToday: () => Promise<CalendarEvent[]>
      getUpcoming: (daysAhead?: number) => Promise<CalendarEvent[]>
      getRecent: (daysBack?: number) => Promise<CalendarEvent[]>
      sync: () => Promise<{ success: boolean }>
      isConnected: () => Promise<boolean>
      connect: () => Promise<{ success: boolean }>
      onSynced: (callback: () => void) => () => void
    }
    gmail: {
      createDraft: (to: string, subject: string, body: string) => Promise<{ success: boolean }>
      isConnected: () => Promise<boolean>
    }
    passNote: {
      generate: (dealId: string, reason: string) => Promise<{ success: boolean; note?: string }>
    }
    boardPrep: {
      getAll: (companyId?: string) => Promise<BoardPrep[]>
      get: (id: string) => Promise<BoardPrep | null>
      getLatest: (companyId: string) => Promise<BoardPrep | null>
      create: (data: Partial<BoardPrep>) => Promise<BoardPrep>
      updateQuestions: (id: string, questions: BoardQuestion[]) => Promise<{ success: boolean }>
      generateQuestions: (boardPrepId: string) => Promise<{ success: boolean; questions?: BoardQuestion[]; error?: string }>
      draftSummary: (boardPrepId: string) => Promise<{ success: boolean; summary?: string; error?: string }>
      saveSummary: (id: string, summary: string, isFinal: boolean) => Promise<{ success: boolean }>
      markGluePosted: (id: string) => Promise<{ success: boolean }>
      detectBoardMeetings: () => Promise<{ success: boolean; meetings?: number; calendar?: number; glueDeals?: number }>
    }
    settings: {
      get: (key: string) => Promise<string | null>
      set: (key: string, value: string) => Promise<{ success: boolean }>
      getAll: () => Promise<Record<string, string>>
    }
    scorecard: {
      create: (dealId: string) => Promise<Scorecard>
      get: (id: string) => Promise<Scorecard | null>
      getByDeal: (dealId: string) => Promise<Scorecard[]>
      update: (id: string, updates: Partial<Scorecard>) => Promise<Scorecard>
      delete: (id: string) => Promise<{ success: boolean }>
      generate: (id: string) => Promise<{ success: boolean; error?: string }>
      suggestMeetings: (companyId: string) => Promise<Meeting[]>
      readFile: (filePath: string) => Promise<{ success: boolean; content?: string; filename?: string; error?: string }>
    }
    sync: {
      forceSync: () => Promise<{ success: boolean }>
    }
    utils: {
      getFilePathFromDrop: (file: File) => string
    }
  }
}
