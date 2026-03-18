import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadToken, saveToken, isTokenExpired, StoredToken } from '../auth'

function makeToken(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expiry_date: Date.now() + 3_600_000, // 1 hour from now
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    ...overrides,
  }
}

describe('loadToken', () => {
  it('returns null when file does not exist', () => {
    const result = loadToken('/nonexistent/path/token.json')
    expect(result).toBeNull()
  })

  it('returns parsed token from valid file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'))
    const tokenPath = path.join(dir, 'token.json')
    const token = makeToken()
    fs.writeFileSync(tokenPath, JSON.stringify(token), 'utf-8')

    const result = loadToken(tokenPath)
    expect(result).toEqual(token)

    fs.rmSync(dir, { recursive: true })
  })

  it('returns null for invalid JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'))
    const tokenPath = path.join(dir, 'token.json')
    fs.writeFileSync(tokenPath, 'not valid json', 'utf-8')

    const result = loadToken(tokenPath)
    expect(result).toBeNull()

    fs.rmSync(dir, { recursive: true })
  })
})

describe('saveToken', () => {
  it('writes token to file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'))
    const tokenPath = path.join(dir, 'token.json')
    const token = makeToken()

    saveToken(tokenPath, token)

    const raw = fs.readFileSync(tokenPath, 'utf-8')
    expect(JSON.parse(raw)).toEqual(token)

    fs.rmSync(dir, { recursive: true })
  })

  it('creates parent directory if it does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'))
    const tokenPath = path.join(dir, 'nested', 'dir', 'token.json')
    const token = makeToken()

    saveToken(tokenPath, token)

    expect(fs.existsSync(tokenPath)).toBe(true)

    fs.rmSync(dir, { recursive: true })
  })
})

describe('isTokenExpired', () => {
  it('returns true when token is in the past', () => {
    const token = makeToken({ expiry_date: Date.now() - 1000 })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true when token expires within 60 seconds', () => {
    const token = makeToken({ expiry_date: Date.now() + 30_000 }) // 30s from now
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns false when token is valid (more than 60s remaining)', () => {
    const token = makeToken({ expiry_date: Date.now() + 3_600_000 }) // 1 hour from now
    expect(isTokenExpired(token)).toBe(false)
  })
})
