import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { OAuth2Client } from 'google-auth-library'

export const DEFAULT_TOKEN_PATH = path.join(
  process.cwd(),
  '.credentials',
  'google-oauth-token.json'
)

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
]

export interface StoredToken {
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
  scope: string
}

export function loadToken(tokenPath: string): StoredToken | null {
  if (!fs.existsSync(tokenPath)) return null
  try {
    const raw = fs.readFileSync(tokenPath, 'utf-8')
    return JSON.parse(raw) as StoredToken
  } catch {
    return null
  }
}

export function saveToken(tokenPath: string, token: StoredToken): void {
  const dir = path.dirname(tokenPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf-8')
}

export function isTokenExpired(token: StoredToken): boolean {
  // Consider expired if within 60 seconds of expiry
  return Date.now() >= token.expiry_date - 60_000
}

export function createOAuthClient(clientId: string, clientSecret: string): OAuth2Client {
  return new OAuth2Client(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob')
}

async function promptAuthCode(authUrl: string): Promise<string> {
  console.log('\nOpen this URL in your browser to authorize:')
  console.log(authUrl)
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question('Paste the authorization code here: ', (code) => {
      rl.close()
      resolve(code.trim())
    })
  })
}

export async function getAuthenticatedClient(
  clientId: string,
  clientSecret: string,
  tokenPath: string = DEFAULT_TOKEN_PATH
): Promise<OAuth2Client> {
  const client = createOAuthClient(clientId, clientSecret)

  const stored = loadToken(tokenPath)

  if (stored) {
    if (isTokenExpired(stored)) {
      // Try to refresh silently
      client.setCredentials(stored)
      try {
        const { credentials } = await client.refreshAccessToken()
        const refreshed: StoredToken = {
          access_token: credentials.access_token!,
          refresh_token: credentials.refresh_token ?? stored.refresh_token,
          expiry_date: credentials.expiry_date!,
          token_type: credentials.token_type ?? 'Bearer',
          scope: credentials.scope ?? stored.scope,
        }
        saveToken(tokenPath, refreshed)
        client.setCredentials(refreshed)
        return client
      } catch {
        // Expired / revoked — delete and re-auth
        fs.unlinkSync(tokenPath)
        process.stderr.write('Google credentials expired — re-authorizing in browser…\n')
      }
    } else {
      client.setCredentials(stored)
      return client
    }
  }

  // Full browser OAuth flow
  const authUrl = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
  const code = await promptAuthCode(authUrl)
  const { tokens } = await client.getToken(code)

  const newToken: StoredToken = {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    expiry_date: tokens.expiry_date!,
    token_type: tokens.token_type ?? 'Bearer',
    scope: tokens.scope ?? SCOPES.join(' '),
  }
  saveToken(tokenPath, newToken)
  client.setCredentials(newToken)
  return client
}
