import type { QzoneCredentials } from '../types'

const USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/138.0.0.0 Safari/537.36',
].join(' ')

export function parseCookieString(cookie: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key) result.set(key, value)
  }
  return result
}

export function normalizeCookieString(values: Map<string, string>): string {
  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
}

export function parseCredentials(cookie: string, source: string, nickname?: string): QzoneCredentials {
  const values = parseCookieString(cookie)
  const rawUin = values.get('uin') || values.get('p_uin') || ''
  const uin = rawUin.replace(/^[oO]/, '')
  const skey = values.get('skey') || ''
  const pSkey = values.get('p_skey') || skey

  if (!/^\d+$/.test(uin)) {
    throw new Error('Cookie 中缺少合法 uin')
  }
  if (!pSkey) {
    throw new Error('Cookie 中缺少 p_skey 或 skey')
  }

  if (!values.has('uin')) values.set('uin', `o${uin}`)
  if (!values.has('p_skey')) values.set('p_skey', pSkey)

  return {
    uin,
    skey,
    pSkey,
    cookie: normalizeCookieString(values),
    source,
    nickname,
  }
}

export class QzoneContext {
  constructor(readonly credentials: QzoneCredentials) {}

  get uin(): string {
    return this.credentials.uin
  }

  get skey(): string {
    return this.credentials.skey
  }

  get pSkey(): string {
    return this.credentials.pSkey
  }

  get gtk2(): string {
    let hash = 5381
    for (const character of this.pSkey) {
      hash += (hash << 5) + character.charCodeAt(0)
      hash |= 0
    }
    return String(hash & 0x7fffffff)
  }

  headers(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      Referer: `https://user.qzone.qq.com/${this.uin}`,
      Origin: 'https://user.qzone.qq.com',
      Cookie: this.credentials.cookie,
      ...overrides,
    }
  }
}
