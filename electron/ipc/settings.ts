import { IpcMain } from 'electron'
import { getDb } from '../db/database'

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('settings:get', (_event, key: string) => {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value || null
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    return { success: true }
  })

  ipcMain.handle('settings:getAll', () => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      // Don't expose tokens
      if (row.key.includes('token') || row.key.includes('secret')) {
        settings[row.key] = '••••••••'
      } else {
        settings[row.key] = row.value
      }
    }
    return settings
  })

  ipcMain.handle('companies:getAll', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM companies ORDER BY name').all()
  })

  ipcMain.handle('companies:getByRelationship', (_event, relationship: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM companies WHERE relationship = ? ORDER BY name').all(relationship)
  })

  ipcMain.handle('companies:rename', (_event, companyId: string, newName: string) => {
    const db = getDb()
    db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(newName.trim(), companyId)
    return db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId)
  })
}
