import { IpcMain } from 'electron'
import { getDb } from '../db/database'
import { v4 as uuid } from 'uuid'
import { enrichDeal, getLinkedMeetings, getCompanyContacts } from '../services/deal-enrichment'
import { generateDealOverview, getCachedOverview } from '../services/deal-overview'
import { getVaultMeetingContent } from '../services/vault-reader'
import { generateShareSummaries } from '../services/deal-sharing'

export function registerDealHandlers(ipcMain: IpcMain) {
  // Enrich all existing deals that are missing contacts (runs once at startup)
  setTimeout(() => {
    const db = getDb()
    const unenriched = db.prepare(`
      SELECT d.id, d.company_id, c.name as company_name
      FROM deals d JOIN companies c ON d.company_id = c.id
      WHERE (d.contact_name IS NULL OR d.contact_name = '')
        AND d.category != 'passed'
    `).all() as Array<{ id: string; company_id: string; company_name: string }>

    for (const deal of unenriched) {
      enrichDeal(deal.company_id, deal.company_name).then(enrichment => {
        if (enrichment.contactName) {
          db.prepare('UPDATE deals SET contact_name = ?, contact_email = ? WHERE id = ?')
            .run(enrichment.contactName, enrichment.contactEmail || null, deal.id)
        }
      }).catch(() => {})
    }
    if (unenriched.length > 0) {
      console.log(`[Deals] Enriching ${unenriched.length} existing deals`)
    }
  }, 5000)

  // Auto-generate overviews for deals that have meetings but no cached overview
  setTimeout(async () => {
    const db = getDb()
    const allDeals = db.prepare(`
      SELECT d.company_id, c.name as company_name
      FROM deals d JOIN companies c ON d.company_id = c.id
      WHERE d.category != 'passed'
    `).all() as Array<{ company_id: string; company_name: string }>

    let generated = 0
    for (const deal of allDeals) {
      const cached = getCachedOverview(deal.company_id)
      if (cached) continue

      // Check both DB meetings and vault files for content
      const meetings = getLinkedMeetings(deal.company_id, deal.company_name)
      const vaultContent = getVaultMeetingContent(deal.company_name)
      if (meetings.length === 0 && vaultContent.count === 0) continue

      try {
        console.log(`[DealOverview] Auto-generating overview for ${deal.company_name} (${meetings.length} meetings)...`)
        await generateDealOverview(deal.company_id, deal.company_name)
        generated++
      } catch (err: any) {
        console.error(`[DealOverview] Failed for ${deal.company_name}:`, err.message)
      }
    }
    if (generated > 0) {
      console.log(`[DealOverview] Auto-generated ${generated} overviews at startup`)
    }
  }, 10000)

  ipcMain.handle('deals:getAll', () => {
    const db = getDb()
    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      ORDER BY d.updated_at DESC
    `).all()
  })

  ipcMain.handle('deals:getByCategory', (_event, category: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.category = ?
      ORDER BY d.moved_at DESC
    `).all(category)
  })

  // Keep old handler for backward compat
  ipcMain.handle('deals:getByStage', (_event, stage: string) => {
    const db = getDb()
    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.category = ?
      ORDER BY d.moved_at DESC
    `).all(stage)
  })

  ipcMain.handle('deals:create', (_event, deal: any) => {
    const db = getDb()
    const id = uuid()

    // Ensure company exists, create if new deal target
    const existing = db.prepare('SELECT id FROM companies WHERE id = ?').get(deal.company_id)
    if (!existing && deal.company_name) {
      const companyId = deal.company_id || deal.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      db.prepare(`
        INSERT OR IGNORE INTO companies (id, name, relationship, domain)
        VALUES (?, ?, 'deal', ?)
      `).run(companyId, deal.company_name, deal.domain || null)
      deal.company_id = companyId
    }

    const category = deal.category || 'first_meeting'

    db.prepare(`
      INSERT INTO deals (id, company_id, stage, category, source, notes, description, revenue, round_size, contact_name, contact_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deal.company_id,
      category,
      category,
      deal.source || null,
      deal.notes || null,
      deal.description || null,
      deal.revenue || null,
      deal.round_size || null,
      deal.contact_name || null,
      deal.contact_email || null
    )

    // Auto-enrich: find contacts from calendar/meetings/email
    const companyName = deal.company_name || ''
    enrichDeal(deal.company_id, companyName).then(enrichment => {
      if (enrichment.contactName || enrichment.contactEmail) {
        // Update deal with discovered contact if not already set
        const current = db.prepare('SELECT contact_name, contact_email FROM deals WHERE id = ?').get(id) as any
        if (!current?.contact_name && !current?.contact_email) {
          db.prepare('UPDATE deals SET contact_name = ?, contact_email = ? WHERE id = ?')
            .run(enrichment.contactName || null, enrichment.contactEmail || null, id)
        }
      }
    }).catch(err => console.error('[Deals] Enrichment failed:', err))

    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(id)
  })

  // Get linked meetings for a deal's company
  ipcMain.handle('deals:getLinkedMeetings', (_event, companyId: string, companyName: string) => {
    const meetings = getLinkedMeetings(companyId, companyName)
    console.log('[Deals] getLinkedMeetings for', companyName, ':', meetings.length, 'found')
    return meetings
  })

  // Get contacts for a deal's company
  ipcMain.handle('deals:getCompanyContacts', (_event, companyId: string) => {
    return getCompanyContacts(companyId)
  })

  // Manually trigger enrichment for an existing deal
  ipcMain.handle('deals:enrich', async (_event, dealId: string) => {
    const db = getDb()
    const deal = db.prepare(`
      SELECT d.*, c.name as company_name FROM deals d
      JOIN companies c ON d.company_id = c.id WHERE d.id = ?
    `).get(dealId) as any
    if (!deal) return { success: false, error: 'Deal not found' }

    const enrichment = await enrichDeal(deal.company_id, deal.company_name)
    if (enrichment.contactName && !deal.contact_name) {
      db.prepare('UPDATE deals SET contact_name = ?, contact_email = ? WHERE id = ?')
        .run(enrichment.contactName, enrichment.contactEmail || null, dealId)
    }
    return { success: true, ...enrichment }
  })

  // Generate structured overview from meeting notes
  ipcMain.handle('deals:generateOverview', async (_event, companyId: string, companyName: string) => {
    console.log('[Deals] generateOverview called for:', companyId, companyName)
    try {
      const overview = await generateDealOverview(companyId, companyName)
      console.log('[Deals] Overview generated:', overview.meetingCount, 'meetings,', overview.sections.length, 'sections')

      // Auto-populate deal description if empty
      const db = getDb()
      const deal = db.prepare('SELECT description FROM deals WHERE company_id = ?').get(companyId) as any
      if (deal && !deal.description && overview.meetingCount > 0) {
        const product = overview.sections.find((s: any) => s.key === 'product')
        const problem = overview.sections.find((s: any) => s.key === 'problem')
        const content = product?.content || problem?.content || ''
        if (content && content !== 'Not discussed in meetings.') {
          const sentences = content.match(/[^.!?]+[.!?]+/g) || [content]
          const desc = sentences.slice(0, 2).join(' ').trim()
          if (desc) {
            db.prepare('UPDATE deals SET description = ? WHERE company_id = ?').run(desc, companyId)
            console.log(`[Deals] Auto-populated description for ${companyName}`)
          }
        }
      }

      return { success: true, overview }
    } catch (err: any) {
      console.error('[Deals] Overview generation failed:', err.message, err.stack)
      return { success: false, error: err.message }
    }
  })

  // Get cached overview
  ipcMain.handle('deals:getCachedOverview', (_event, companyId: string) => {
    console.log('[Deals] getCachedOverview called for:', companyId)
    const cached = getCachedOverview(companyId)
    console.log('[Deals] Cached overview:', cached ? 'found' : 'not found')
    return cached
  })

  ipcMain.handle('deals:update', (_event, id: string, updates: any) => {
    const db = getDb()
    const allowedFields = [
      'stage', 'category', 'source', 'notes', 'description', 'revenue',
      'round_size', 'pass_reason', 'pass_note', 'contact_name', 'contact_email'
    ]
    const fields = Object.keys(updates)
      .filter(k => allowedFields.includes(k))
      .map(k => `${k} = ?`)

    if (fields.length === 0) return null

    const values = Object.keys(updates)
      .filter(k => allowedFields.includes(k))
      .map(k => updates[k])

    db.prepare(`
      UPDATE deals SET ${fields.join(', ')}, updated_at = datetime('now')
      WHERE id = ?
    `).run(...values, id)

    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(id)
  })

  ipcMain.handle('deals:updateCategory', (_event, id: string, category: string) => {
    const db = getDb()
    db.prepare(`
      UPDATE deals SET category = ?, stage = ?, moved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(category, category, id)

    if (category === 'passed') {
      const deal = db.prepare('SELECT company_id FROM deals WHERE id = ?').get(id) as any
      if (deal?.company_id) {
        const result = db.prepare(`
          UPDATE todos SET status = 'dismissed'
          WHERE company_id = ? AND status = 'open'
        `).run(deal.company_id)
        if (result.changes > 0) {
          console.log(`[Deals] Dismissed ${result.changes} open todo(s) for passed deal company ${deal.company_id}`)
        }
      }
    }

    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(id)
  })

  // Keep old handler for backward compat
  ipcMain.handle('deals:updateStage', (_event, id: string, stage: string) => {
    const db = getDb()
    db.prepare(`
      UPDATE deals SET stage = ?, category = ?, moved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(stage, stage, id)

    return db.prepare(`
      SELECT d.*, c.name as company_name, c.relationship
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(id)
  })

  ipcMain.handle('deals:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM deals WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('deals:generateShareSummaries', async (_event, deals: Array<{ companyId: string; companyName: string; contactName?: string }>) => {
    try {
      const results = await generateShareSummaries(deals)
      return { success: true, summaries: results }
    } catch (err: any) {
      console.error('[DealSharing] Error:', err.message)
      return { success: false, error: err.message, summaries: [] }
    }
  })
}
