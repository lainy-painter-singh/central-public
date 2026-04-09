import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { initDatabase } from './db/database'
import { registerDealHandlers } from './ipc/deals'
import { registerTodoHandlers } from './ipc/todos'
import { registerMeetingHandlers } from './ipc/meetings'
import { registerCalendarHandlers } from './ipc/calendar'
import { registerGmailHandlers } from './ipc/gmail'
import { registerSettingsHandlers } from './ipc/settings'
import { registerBoardPrepHandlers } from './ipc/boardPrep'
import { registerScorecardHandlers } from './ipc/scorecard'
import { runBoardDetection } from './services/board-detector'
import { detectNewDeals } from './services/deal-detector'
import { detectPitchMeetingTodos } from './services/todo-generator'
import { scanEmailsForActionItems } from './services/email-scanner'
import { processReadyBoardPreps } from './services/board-meeting-workflow'
import { syncCalendarEvents } from './services/google-calendar'
import { syncGranolaMeetings } from './services/granola'
import { syncFellowMeetings, isFellowConfigured } from './services/fellow'
import { isGoogleConnected } from './services/google-auth'
import { exportRecentMeetings } from './services/markdown-exporter'

let mainWindow: BrowserWindow | null = null
let syncInterval: ReturnType<typeof setInterval> | null = null

const DIST = path.join(__dirname, '../dist')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000 // 3 hours

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Run the full sync cycle: Granola, Fellow, calendar, deals, board detection,
 * pitch detection, board workflow, email scan.
 */
async function runFullSync(label: string) {
  console.log(`[${label}] Starting full sync...`)

  // Sync meetings from Granola
  try {
    const count = await syncGranolaMeetings(90)
    if (count > 0) console.log(`[${label}] Granola: synced ${count} meetings`)
  } catch (err: any) {
    console.error(`[${label}] Granola sync error:`, err.message)
  }

  // Sync meetings from Fellow
  if (isFellowConfigured()) {
    try {
      const count = await syncFellowMeetings(30)
      if (count > 0) console.log(`[${label}] Fellow: synced ${count} meetings`)
    } catch (err: any) {
      console.error(`[${label}] Fellow sync error:`, err.message)
    }
  }

  // Deal detection
  try {
    const newDeals = detectNewDeals()
    if (newDeals > 0) console.log(`[${label}] Deal detection: ${newDeals} new deals`)
  } catch (err) {
    console.error(`[${label}] Deal detection error:`, err)
  }

  // Board detection
  try {
    const result = runBoardDetection()
    if (result.meetings + result.calendar + result.glueDeals > 0) {
      console.log(`[${label}] Board detection: ${result.meetings} meetings, ${result.calendar} calendar, ${result.glueDeals} glue todos`)
    }
  } catch (err) {
    console.error(`[${label}] Board detection error:`, err)
  }

  // Calendar + dependent tasks (only if Google connected)
  if (isGoogleConnected()) {
    try {
      const count = await syncCalendarEvents(7, 5)
      console.log(`[${label}] Calendar synced: ${count} events`)

      try {
        const pitchTodos = detectPitchMeetingTodos()
        if (pitchTodos > 0) console.log(`[${label}] Pitch detection: ${pitchTodos} review todos`)
      } catch (err) {
        console.error(`[${label}] Pitch detection error:`, err)
      }

      try {
        const result = await processReadyBoardPreps()
        if (result.drafted + result.docsFound > 0) {
          console.log(`[${label}] Board workflow: ${result.drafted} drafted, ${result.docsFound} doc searches`)
        }
      } catch (err) {
        console.error(`[${label}] Board workflow error:`, err)
      }
    } catch (err: any) {
      console.error(`[${label}] Calendar sync error:`, err.message)
    }

    try {
      const count = await scanEmailsForActionItems()
      if (count > 0) console.log(`[${label}] Email scan: ${count} action items`)
    } catch (err: any) {
      console.error(`[${label}] Email scan error:`, err.message)
    }
  }

  // Export meetings to Obsidian vault
  try {
    const exported = exportRecentMeetings(90)
    if (exported > 0) console.log(`[${label}] Obsidian export: ${exported} meetings`)
  } catch (err: any) {
    console.error(`[${label}] Obsidian export error:`, err.message)
  }

  // Notify renderer to refresh
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('calendar:synced')
  }

  console.log(`[${label}] Full sync complete`)
}

app.whenReady().then(() => {
  // Initialize database
  initDatabase()

  // Register IPC handlers
  registerDealHandlers(ipcMain)
  registerTodoHandlers(ipcMain)
  registerMeetingHandlers(ipcMain)
  registerCalendarHandlers(ipcMain)
  registerGmailHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
  registerBoardPrepHandlers(ipcMain)
  registerScorecardHandlers(ipcMain)

  // Force sync handler — callable from renderer
  ipcMain.handle('sync:forceSync', async () => {
    try {
      await runFullSync('ForceSync')
      return { success: true }
    } catch (err: any) {
      console.error('[ForceSync] Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Run initial sync after a short delay
  setTimeout(() => runFullSync('Startup'), 2000)

  // Auto-sync every 3 hours
  syncInterval = setInterval(() => runFullSync('AutoSync'), SYNC_INTERVAL_MS)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (syncInterval) clearInterval(syncInterval)
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
