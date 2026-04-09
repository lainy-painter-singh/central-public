import { IpcMain } from 'electron'
import { isGoogleConnected } from '../services/google-auth'
import { createGmailDraft } from '../services/gmail'
import { getDb } from '../db/database'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'

function getOpenAIKey(): string | null {
  const envPath = path.join(os.homedir(), '.granola-archivist', '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/OPENAI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }
  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get() as any
  if (setting?.value) return setting.value
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  return null
}

const PASS_NOTE_SYSTEM = `You write VC investment pass notes (rejection emails) to founders. These are brief emails (3-5 short paragraphs, ~75-175 words) that respect the founder's time and leave the relationship intact.

You are writing as Lainy at Craft Ventures.

Tone and style:
- Warm but direct. Do not hedge or bury the pass decision.
- Use "we" for the firm, "I" for personal observations.
- First-name basis. No "Dear" or overly formal salutations.
- Conversational, reads like a note from a peer, not a form letter.
- Genuine compliments backed by specifics (metrics, names, details from the pitch).
- The pass reason should be honest and constructive, not vague. Name the specific concern.
- Close warmly but briefly. No lengthy sign-offs.
- Do not use bullet points, headers, or formatting. Plain email prose only.
- Do not use exclamation marks more than once.
- No subject line. Just the email body.
- Never use brackets, placeholders, or template markers.

Structure (each element is roughly one short paragraph):
1. Greeting + thank you. Thank them for the meeting/walkthrough. Reference the company by name.
2. Specific compliment. Call out what genuinely impressed you, cite a metric, a customer name, a team member, or a product insight. Be concrete.
3. The pass. State the decision clearly in one sentence. Use language like "we've decided to pass on this round" or "we're going to pass on leading this round." Do not soften it into ambiguity.
4. The reason. Give the honest, specific reason. Frame it constructively when possible, what you'd want to see in the future, or what the team debated.
5. Warm close. One sentence wishing them well or acknowledging next steps.

Example 1 (too-early-stage pass):
Hi Devrim,
Thanks for walking me through Lucky Robots. The team you've assembled is impressive (Jan and Harrison are great additions) and the fact that OpenAI's robotics division said this is what they wanted to build internally says a lot.
That said, we're going to pass on this round. We believe that sim will be a huge part of scaling robotics, but Lucky is a little too early for us today. We would love to see a few contracts signed before leading a round.
Best of luck with the launch and the OpenAI relationship.

Example 2 (market-structure concern):
Hi Aris,
Thank you for walking me through Solstice. Going from zero to $1.6M ARR in six months with three top-10 pharma companies is impressive execution. Cutting review cycles from 3+ rounds to 1.2 clearly resonates.
After thinking it through, we've decided to pass on this round. I'm not sure this will be a winner take all market with venture scale returns versus support a few large, profitable AI-driven agencies. I could be wrong here, but wanted to be transparent about the hesitation today.
Wishing you the best with the raise.`

function fallbackTemplate(companyName: string, contactName: string, reason: string): string {
  const firstName = contactName.split(' ')[0] || contactName
  return `Hi ${firstName},

Thanks for walking me through ${companyName}.

After discussing internally, we've decided to pass on this round. ${reason || 'The timing isn\'t quite right for us today.'}

Best of luck with the raise.`
}

export function registerGmailHandlers(ipcMain: IpcMain) {
  ipcMain.handle('gmail:createDraft', async (_event, to: string, subject: string, body: string) => {
    try {
      const result = await createGmailDraft(to, subject, body)
      return { success: true, draftId: result.draftId }
    } catch (err: any) {
      console.error('[Gmail] Draft creation error:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('gmail:isConnected', () => {
    try {
      return isGoogleConnected()
    } catch {
      return false
    }
  })

  ipcMain.handle('passNote:generate', async (_event, dealId: string, reason: string) => {
    const db = getDb()
    const deal = db.prepare(`
      SELECT d.*, c.name as company_name
      FROM deals d
      JOIN companies c ON d.company_id = c.id
      WHERE d.id = ?
    `).get(dealId) as any

    if (!deal) {
      return { success: false, error: 'Deal not found' }
    }

    const contactName = deal.contact_name || 'there'
    const companyName = deal.company_name

    // Try AI generation
    const apiKey = getOpenAIKey()
    if (apiKey) {
      try {
        // Fetch recent meeting context for this company
        const meetings = db.prepare(`
          SELECT title, summary FROM meetings
          WHERE company_id = ? AND summary IS NOT NULL
          ORDER BY date DESC LIMIT 3
        `).all(deal.company_id) as any[]

        const meetingContext = meetings.length > 0
          ? `\n\nRecent meeting context:\n${meetings.map(m => `- ${m.title}: ${(m.summary || '').slice(0, 500)}`).join('\n')}`
          : ''

        const openai = new OpenAI({ apiKey })
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          messages: [
            { role: 'system', content: PASS_NOTE_SYSTEM },
            {
              role: 'user',
              content: `Write a pass email to ${contactName} at ${companyName}.${reason ? `\nReason for passing: ${reason}` : ''}${meetingContext}`,
            },
          ],
        })

        const note = response.choices[0]?.message?.content?.trim()
        if (note) {
          db.prepare('UPDATE deals SET pass_note = ?, pass_reason = ? WHERE id = ?').run(note, reason, dealId)
          console.log(`[PassNote] AI-generated pass note for ${companyName}`)
          return { success: true, note }
        }
      } catch (err: any) {
        console.error('[PassNote] AI generation failed, using template:', err.message)
      }
    }

    // Fallback to template
    const note = fallbackTemplate(companyName, contactName, reason)
    db.prepare('UPDATE deals SET pass_note = ?, pass_reason = ? WHERE id = ?').run(note, reason, dealId)
    return { success: true, note }
  })
}
