import { google } from 'googleapis'
import { getAuthenticatedClient } from './google-auth'

/**
 * Create a Gmail draft.
 * Returns the draft ID on success.
 */
export async function createGmailDraft(
  to: string,
  subject: string,
  body: string
): Promise<{ draftId: string; success: boolean }> {
  const auth = await getAuthenticatedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  // Build RFC 2822 message
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\n')

  // Base64url encode
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  try {
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: encodedMessage,
        },
      },
    })

    console.log(`[Gmail] Draft created: ${response.data.id}`)
    return { draftId: response.data.id || '', success: true }
  } catch (err: any) {
    console.error('[Gmail] Draft creation error:', err.message)
    throw err
  }
}
