import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // Deals
  deals: {
    getAll: () => ipcRenderer.invoke('deals:getAll'),
    getByCategory: (category: string) => ipcRenderer.invoke('deals:getByCategory', category),
    getByStage: (stage: string) => ipcRenderer.invoke('deals:getByStage', stage),
    create: (deal: any) => ipcRenderer.invoke('deals:create', deal),
    update: (id: string, updates: any) => ipcRenderer.invoke('deals:update', id, updates),
    updateCategory: (id: string, category: string) => ipcRenderer.invoke('deals:updateCategory', id, category),
    updateStage: (id: string, stage: string) => ipcRenderer.invoke('deals:updateStage', id, stage),
    delete: (id: string) => ipcRenderer.invoke('deals:delete', id),
    getLinkedMeetings: (companyId: string, companyName: string) => ipcRenderer.invoke('deals:getLinkedMeetings', companyId, companyName),
    getCompanyContacts: (companyId: string) => ipcRenderer.invoke('deals:getCompanyContacts', companyId),
    enrich: (dealId: string) => ipcRenderer.invoke('deals:enrich', dealId),
    generateOverview: (companyId: string, companyName: string) => ipcRenderer.invoke('deals:generateOverview', companyId, companyName),
    getCachedOverview: (companyId: string) => ipcRenderer.invoke('deals:getCachedOverview', companyId),
    generateShareSummaries: (deals: Array<{ companyId: string; companyName: string; contactName?: string }>) => ipcRenderer.invoke('deals:generateShareSummaries', deals),
  },

  // Todos
  todos: {
    getAll: (filters?: any) => ipcRenderer.invoke('todos:getAll', filters),
    getOpen: () => ipcRenderer.invoke('todos:getOpen'),
    getByCompany: (companyId: string) => ipcRenderer.invoke('todos:getByCompany', companyId),
    create: (todo: any) => ipcRenderer.invoke('todos:create', todo),
    update: (id: string, updates: any) => ipcRenderer.invoke('todos:update', id, updates),
    markDone: (id: string) => ipcRenderer.invoke('todos:markDone', id),
    dismiss: (id: string) => ipcRenderer.invoke('todos:dismiss', id),
  },

  // Companies
  companies: {
    getAll: () => ipcRenderer.invoke('companies:getAll'),
    getByRelationship: (rel: string) => ipcRenderer.invoke('companies:getByRelationship', rel),
    rename: (companyId: string, newName: string) => ipcRenderer.invoke('companies:rename', companyId, newName),
  },

  // Meetings
  meetings: {
    syncGranola: () => ipcRenderer.invoke('meetings:syncGranola'),
    syncFellow: () => ipcRenderer.invoke('meetings:syncFellow'),
    getRecent: (days?: number) => ipcRenderer.invoke('meetings:getRecent', days),
    generateTodos: (meetingId: string) => ipcRenderer.invoke('meetings:generateTodos', meetingId),
    exportAll: () => ipcRenderer.invoke('meetings:exportAll'),
  },

  // Calendar
  calendar: {
    getToday: () => ipcRenderer.invoke('calendar:getToday'),
    getUpcoming: (daysAhead?: number) => ipcRenderer.invoke('calendar:getUpcoming', daysAhead),
    getRecent: (daysBack?: number) => ipcRenderer.invoke('calendar:getRecent', daysBack),
    sync: () => ipcRenderer.invoke('calendar:sync'),
    isConnected: () => ipcRenderer.invoke('calendar:isConnected'),
    connect: () => ipcRenderer.invoke('calendar:connect'),
    onSynced: (callback: () => void) => {
      ipcRenderer.on('calendar:synced', callback)
      return () => { ipcRenderer.removeListener('calendar:synced', callback) }
    },
  },

  // Gmail
  gmail: {
    createDraft: (to: string, subject: string, body: string) =>
      ipcRenderer.invoke('gmail:createDraft', to, subject, body),
    isConnected: () => ipcRenderer.invoke('gmail:isConnected'),
  },

  // Pass notes
  passNote: {
    generate: (dealId: string, reason: string) =>
      ipcRenderer.invoke('passNote:generate', dealId, reason),
  },

  // Board Prep
  boardPrep: {
    getAll: (companyId?: string) => ipcRenderer.invoke('boardPrep:getAll', companyId),
    get: (id: string) => ipcRenderer.invoke('boardPrep:get', id),
    getLatest: (companyId: string) => ipcRenderer.invoke('boardPrep:getLatest', companyId),
    create: (data: any) => ipcRenderer.invoke('boardPrep:create', data),
    updateQuestions: (id: string, questions: any[]) => ipcRenderer.invoke('boardPrep:updateQuestions', id, questions),
    generateQuestions: (boardPrepId: string) => ipcRenderer.invoke('boardPrep:generateQuestions', boardPrepId),
    draftSummary: (boardPrepId: string) => ipcRenderer.invoke('boardPrep:draftSummary', boardPrepId),
    saveSummary: (id: string, summary: string, isFinal: boolean) => ipcRenderer.invoke('boardPrep:saveSummary', id, summary, isFinal),
    markGluePosted: (id: string) => ipcRenderer.invoke('boardPrep:markGluePosted', id),
    detectBoardMeetings: () => ipcRenderer.invoke('boardPrep:detectBoardMeetings'),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
  },

  // Scorecard
  scorecard: {
    create: (dealId: string) => ipcRenderer.invoke('scorecard:create', dealId),
    get: (id: string) => ipcRenderer.invoke('scorecard:get', id),
    getByDeal: (dealId: string) => ipcRenderer.invoke('scorecard:getByDeal', dealId),
    update: (id: string, updates: any) => ipcRenderer.invoke('scorecard:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('scorecard:delete', id),
    generate: (id: string) => ipcRenderer.invoke('scorecard:generate', id),
    suggestMeetings: (companyId: string) => ipcRenderer.invoke('scorecard:suggestMeetings', companyId),
    readFile: (filePath: string) => ipcRenderer.invoke('scorecard:readFile', filePath),
  },

  // Sync
  sync: {
    forceSync: () => ipcRenderer.invoke('sync:forceSync'),
  },

  // Utilities
  utils: {
    // In Electron 20+, file.path is empty with contextIsolation.
    // webUtils.getPathForFile() is the correct way to get the filesystem path.
    getFilePathFromDrop: (file: File) => webUtils.getPathForFile(file),
  },
}

contextBridge.exposeInMainWorld('central', api)

export type CentralAPI = typeof api
