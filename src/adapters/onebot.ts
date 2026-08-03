import type { Bot } from 'koishi'

import type { CredentialAdapter, CredentialResult } from '../types'
import { asRecord, asString, isRecord } from '../types'

interface OneBotInternalLike {
  getCookies?: (domain?: string) => Promise<unknown>
  getCredentials?: (domain?: string) => Promise<unknown>
  getLoginInfo?: () => Promise<unknown>
  _request?: (action: string, params: Record<string, unknown>) => Promise<unknown>
}

function extractCookie(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  const record = asRecord(payload)
  const direct = asString(record.cookies).trim()
  if (direct) return direct
  const data = asRecord(record.data)
  return asString(data.cookies).trim()
}

function extractNickname(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const data = isRecord(record.data) ? record.data : record
  const nickname = asString(data.nickname).trim()
  return nickname || undefined
}

export class KoishiOneBotAdapter implements CredentialAdapter {
  readonly name = 'koishi-onebot'

  constructor(
    private readonly resolveBot: () => Bot | undefined,
    private readonly domain = 'user.qzone.qq.com',
  ) {}

  async getCredential(): Promise<CredentialResult> {
    const bot = this.resolveBot()
    if (!bot) throw new Error('未找到可用的 Koishi 机器人')
    const internal = bot.internal as OneBotInternalLike | undefined
    if (!internal) throw new Error(`机器人 ${bot.selfId} 未暴露 internal API`)

    let cookie = ''
    if (typeof internal.getCookies === 'function') {
      cookie = extractCookie(await internal.getCookies(this.domain))
    }
    if (!cookie && typeof internal.getCredentials === 'function') {
      cookie = extractCookie(await internal.getCredentials(this.domain))
    }
    if (!cookie && typeof internal._request === 'function') {
      cookie = extractCookie(await internal._request('get_cookies', { domain: this.domain }))
    }
    if (!cookie) {
      throw new Error('当前 OneBot 实现未返回 Qzone Cookie')
    }

    let nickname = bot.user?.name || undefined
    if (!nickname && typeof internal.getLoginInfo === 'function') {
      nickname = extractNickname(await internal.getLoginInfo())
    }
    return { cookie, nickname, source: this.name }
  }
}

export interface OneBotHttpOptions {
  baseUrl: string
  accessToken?: string
  allowInsecure?: boolean
  timeoutMs: number
  fetch?: typeof globalThis.fetch
}

export class OneBotHttpAdapter implements CredentialAdapter {
  readonly name = 'onebot-http'
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: OneBotHttpOptions) {
    this.fetchImpl = options.fetch || globalThis.fetch
  }

  async getCredential(): Promise<CredentialResult> {
    const baseUrl = this.options.baseUrl.trim()
    if (!baseUrl) throw new Error('未配置 OneBot HTTP API 地址')

    const cookiePayload = await this.callAction('get_cookies', {
      domain: 'user.qzone.qq.com',
    })
    const cookie = extractCookie(cookiePayload)
    if (!cookie) throw new Error('OneBot HTTP get_cookies 未返回 Cookie')

    let nickname: string | undefined
    try {
      nickname = extractNickname(await this.callAction('get_login_info', {}))
    } catch {
      // Login metadata is optional; the cookie is sufficient for Qzone.
    }
    return { cookie, nickname, source: this.name }
  }

  private async callAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.options.accessToken) {
      headers.Authorization = `Bearer ${this.options.accessToken}`
    }

    try {
      const base = new URL(this.options.baseUrl)
      const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)
      if (base.protocol !== 'https:' && !loopback && !this.options.allowInsecure) {
        throw new Error('非回环 OneBot HTTP 地址必须使用 HTTPS')
      }
      const endpoint = new URL(action, base.href.replace(/\/?$/, '/'))
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`OneBot HTTP ${response.status}`)
      }
      const payload: unknown = await response.json()
      const record = asRecord(payload)
      const retcode = Number(record.retcode ?? 0)
      if (Number.isFinite(retcode) && retcode !== 0) {
        throw new Error(`OneBot ${action} 失败：retcode=${retcode}`)
      }
      return record.data ?? payload
    } finally {
      clearTimeout(timeout)
    }
  }
}
