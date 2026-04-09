import { create } from 'zustand'
import type { Scorecard, Meeting } from '../lib/ipc'
import { getAPI } from '../lib/ipc'

interface UploadedFile {
  filename: string
  content: string
}

interface ScorecardStore {
  // Active scorecard state
  activeScorecard: Scorecard | null
  activeDealId: string | null

  // Meeting selection
  suggestedMeetings: Meeting[]
  selectedMeetingIds: Set<string>

  // File uploads
  uploadedFiles: UploadedFile[]

  // Additional notes
  additionalNotes: string

  // UI state
  generating: boolean
  error: string | null
  activeSlideIndex: number

  // Actions
  initFromDeal: (dealId: string) => Promise<void>
  loadExisting: (scorecardId: string) => Promise<void>
  addFile: (filePath: string) => Promise<void>
  removeFile: (index: number) => void
  toggleMeeting: (meetingId: string) => void
  setAdditionalNotes: (notes: string) => void
  setActiveSlide: (index: number) => void
  generate: () => Promise<void>
  reset: () => void
}

export const useScorecardStore = create<ScorecardStore>((set, get) => ({
  activeScorecard: null,
  activeDealId: null,
  suggestedMeetings: [],
  selectedMeetingIds: new Set(),
  uploadedFiles: [],
  additionalNotes: '',
  generating: false,
  error: null,
  activeSlideIndex: 0,

  initFromDeal: async (dealId: string) => {
    set({ generating: false, error: null, uploadedFiles: [], additionalNotes: '', activeSlideIndex: 0 })
    try {
      // Create a new scorecard record
      const scorecard = await getAPI().scorecard.create(dealId)
      if (!scorecard) {
        set({ error: 'Deal not found' })
        return
      }

      // Get suggested meetings for this company
      const meetings = await getAPI().scorecard.suggestMeetings(scorecard.company_id)

      // Pre-select all suggested meetings
      const selectedIds = new Set(meetings.map((m: Meeting) => m.id))

      set({
        activeScorecard: scorecard,
        activeDealId: dealId,
        suggestedMeetings: meetings,
        selectedMeetingIds: selectedIds,
      })
    } catch (err: any) {
      console.error('Failed to init scorecard:', err)
      set({ error: err.message })
    }
  },

  loadExisting: async (scorecardId: string) => {
    try {
      const scorecard = await getAPI().scorecard.get(scorecardId)
      if (!scorecard) {
        set({ error: 'Scorecard not found' })
        return
      }

      const meetings = await getAPI().scorecard.suggestMeetings(scorecard.company_id)
      const selectedIds = new Set<string>(JSON.parse(scorecard.meeting_ids || '[]'))
      const files: UploadedFile[] = JSON.parse(scorecard.file_contents || '[]')

      set({
        activeScorecard: scorecard,
        activeDealId: scorecard.deal_id,
        suggestedMeetings: meetings,
        selectedMeetingIds: selectedIds,
        uploadedFiles: files,
        additionalNotes: scorecard.additional_notes || '',
        error: null,
        activeSlideIndex: 0,
      })
    } catch (err: any) {
      console.error('Failed to load scorecard:', err)
      set({ error: err.message })
    }
  },

  addFile: async (filePath: string) => {
    try {
      const result = await getAPI().scorecard.readFile(filePath)
      if (result.success && result.content && result.filename) {
        set(state => ({
          uploadedFiles: [...state.uploadedFiles, { filename: result.filename!, content: result.content! }],
          error: null,
        }))
      } else {
        set({ error: result.error || 'Failed to read file' })
      }
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  removeFile: (index: number) => {
    set(state => ({
      uploadedFiles: state.uploadedFiles.filter((_, i) => i !== index),
    }))
  },

  toggleMeeting: (meetingId: string) => {
    set(state => {
      const next = new Set(state.selectedMeetingIds)
      if (next.has(meetingId)) next.delete(meetingId)
      else next.add(meetingId)
      return { selectedMeetingIds: next }
    })
  },

  setAdditionalNotes: (notes: string) => {
    set({ additionalNotes: notes })
  },

  setActiveSlide: (index: number) => {
    set({ activeSlideIndex: index })
  },

  generate: async () => {
    const { activeScorecard, selectedMeetingIds, uploadedFiles, additionalNotes } = get()
    if (!activeScorecard) return

    set({ generating: true, error: null })

    try {
      // Save inputs to the scorecard record first
      await getAPI().scorecard.update(activeScorecard.id, {
        meeting_ids: JSON.stringify([...selectedMeetingIds]),
        file_contents: JSON.stringify(uploadedFiles),
        additional_notes: additionalNotes || null,
      } as any)

      // Generate
      const result = await getAPI().scorecard.generate(activeScorecard.id)

      if (result.success) {
        // Reload the scorecard to get the generated slides
        const updated = await getAPI().scorecard.get(activeScorecard.id)
        set({ activeScorecard: updated, generating: false, activeSlideIndex: 0 })
      } else {
        set({ generating: false, error: result.error || 'Generation failed' })
      }
    } catch (err: any) {
      console.error('Scorecard generation failed:', err)
      set({ generating: false, error: err.message })
    }
  },

  reset: () => {
    set({
      activeScorecard: null,
      activeDealId: null,
      suggestedMeetings: [],
      selectedMeetingIds: new Set(),
      uploadedFiles: [],
      additionalNotes: '',
      generating: false,
      error: null,
      activeSlideIndex: 0,
    })
  },
}))
