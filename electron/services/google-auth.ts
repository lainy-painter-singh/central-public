import { google } from 'googleapis'
import { BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import fs from 'fs'
import path from 'path'
import http from 'http'
import { URL } from 'url'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
]

const REDIRECT_PORT = 18923
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`

interface GoogleCredentials {
  client_id: string
  client_secret: string
}

function getCredentials(): GoogleCredentials | null {
  // Check multiple locations for credentials
  const locations = [
    path.join(process.cwd(), 'config', 'credentials.json'),
    path.join(__dirname, '..', '..', 'config', 'credentials.json'),
    path.join(__dirname, '..', 'config', 'credentials.json'),
  ]

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        const data = JSON.parse(fs.readFileSync(loc, 'utf-8'))
        // Google credentials can come in different formats
        const creds = data.installed || data.web || data
        if (creds.client_id && creds.client_secret) {
          return { client_id: creds.client_id, client_secret: creds.client_secret }
        }
      } catch {
        continue
      }
    }
  }

  // Also check settings in DB
  const db = getDb()
  const clientId = db.prepare("SELECT value FROM settings WHERE key = 'google_client_id'").get() as any
  const clientSecret = db.prepare("SELECT value FROM settings WHERE key = 'google_client_secret'").get() as any

  if (clientId?.value && clientSecret?.value) {
    return { client_id: clientId.value, client_secret: clientSecret.value }
  }

  return null
}

function getOAuth2Client() {
  const creds = getCredentials()
  if (!creds) {
    throw new Error('Google credentials not found. Place credentials.json in config/ directory.')
  }

  return new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI)
}

export function isGoogleConnected(): boolean {
  const db = getDb()
  const token = db.prepare("SELECT value FROM settings WHERE key = 'google_refresh_token'").get() as any
  return !!token?.value
}

export async function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client()
  const db = getDb()

  const refreshToken = db.prepare("SELECT value FROM settings WHERE key = 'google_refresh_token'").get() as any
  const accessToken = db.prepare("SELECT value FROM settings WHERE key = 'google_access_token'").get() as any

  if (!refreshToken?.value) {
    throw new Error('Not authenticated. Call connectGoogle() first.')
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken.value,
    access_token: accessToken?.value || undefined,
  })

  // Auto-refresh if needed
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)").run(tokens.access_token)
    }
    if (tokens.refresh_token) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_refresh_token', ?)").run(tokens.refresh_token)
    }
  })

  return oauth2Client
}

export async function connectGoogle(): Promise<boolean> {
  const creds = getCredentials()
  if (!creds) {
    console.error('[Google] No credentials found')
    return false
  }

  const oauth2Client = getOAuth2Client()

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  return new Promise((resolve) => {
    // Start local server to receive callback
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`)
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404)
          res.end()
          return
        }

        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400)
          res.end('No authorization code received')
          server.close()
          resolve(false)
          return
        }

        const { tokens } = await oauth2Client.getToken(code)
        const db = getDb()

        if (tokens.refresh_token) {
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_refresh_token', ?)").run(tokens.refresh_token)
        }
        if (tokens.access_token) {
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_access_token', ?)").run(tokens.access_token)
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <html>
            <body style="background:#0a0a0a;color:#fafafa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <h2>Connected!</h2>
                <p style="color:#a3a3a3">You can close this window and return to Central.</p>
              </div>
            </body>
          </html>
        `)

        server.close()
        console.log('[Google] Successfully authenticated')
        resolve(true)
      } catch (err) {
        console.error('[Google] OAuth error:', err)
        res.writeHead(500)
        res.end('Authentication failed')
        server.close()
        resolve(false)
      }
    })

    server.listen(REDIRECT_PORT, () => {
      // Open auth URL in a new window
      const authWindow = new BrowserWindow({
        width: 600,
        height: 700,
        title: 'Connect Google Account',
      })
      authWindow.loadURL(authUrl)

      // If user closes window without completing auth
      authWindow.on('closed', () => {
        setTimeout(() => {
          server.close()
        }, 1000)
      })
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close()
      resolve(false)
    }, 300000)
  })
}
