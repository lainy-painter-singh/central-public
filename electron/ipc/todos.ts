import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'

export function registerTodoHandlers(ipcMain: IpcMain) {
  ipcMain.handle('todos:getAll', (_event, filters?: any) => {
    const db = getDb()
    let query = `
      SELECT t.*, c.name as company_name
      FROM todos t
      LEFT JOIN companies c ON t.company_id = c.id
    `
    const conditions: string[] = []
    const params: any[] = []

    if (filters?.status) {
      conditions.push('t.status = ?')
      params.push(filters.status)
    }
    if (filters?.type) {
      conditions.push('t.type = ?')
      params.push(filters.type)
    }
    if (filters?.company_id) {
      conditions.push('t.company_id = ?')
      params.push(filters.company_id)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    // Priority ordering: urgent > high > medium > low
    query += ` ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      t.created_at DESC`

    return db.prepare(query).all(...params)
  })

  ipcMain.handle('todos:getOpen', () => {
    const db = getDb()
    return db.prepare(`
      SELECT t.*, c.name as company_name
      FROM todos t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.status = 'open'
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        t.created_at DESC
    `).all()
  })

  ipcMain.handle('todos:getByCompany', (_event, companyId: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT t.*, c.name as company_name
      FROM todos t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.company_id = ? AND t.status = 'open'
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        t.created_at DESC
    `).all(companyId)
  })

  ipcMain.handle('todos:create', (_event, todo: any) => {
    const db = getDb()
    const id = uuid()

    db.prepare(`
      INSERT INTO todos (id, title, company_id, type, priority, source, source_meeting_id, source_meeting_title, deadline, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      todo.title,
      todo.company_id || null,
      todo.type || 'manual',
      todo.priority || 'medium',
      todo.source || 'manual',
      todo.source_meeting_id || null,
      todo.source_meeting_title || null,
      todo.deadline || null,
      todo.context || null
    )

    return db.prepare(`
      SELECT t.*, c.name as company_name
      FROM todos t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.id = ?
    `).get(id)
  })

  ipcMain.handle('todos:update', (_event, id: string, updates: any) => {
    const db = getDb()
    const fields = Object.keys(updates)
      .filter(k => ['title', 'priority', 'status', 'deadline', 'context', 'company_id', 'type'].includes(k))
      .map(k => `${k} = ?`)

    if (fields.length === 0) return null

    const values = Object.keys(updates)
      .filter(k => ['title', 'priority', 'status', 'deadline', 'context', 'company_id', 'type'].includes(k))
      .map(k => updates[k])

    db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)

    return db.prepare(`
      SELECT t.*, c.name as company_name
      FROM todos t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.id = ?
    `).get(id)
  })

  ipcMain.handle('todos:markDone', (_event, id: string) => {
    const db = getDb()
    db.prepare(`
      UPDATE todos SET status = 'done', completed_at = datetime('now') WHERE id = ?
    `).run(id)
    return { success: true }
  })

  ipcMain.handle('todos:dismiss', (_event, id: string) => {
    const db = getDb()
    db.prepare(`UPDATE todos SET status = 'dismissed' WHERE id = ?`).run(id)
    return { success: true }
  })
}
