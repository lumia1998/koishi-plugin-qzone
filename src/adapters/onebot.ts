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
  if (typeof record.data === 'string') return record.data.trim()
  return asString(asRecord(record.data).cookies).trim()
}

function extractNickname(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const data = isRecord(record.data) ? record.data : record
  const nickname = asString(data.nickname).trim()
  return nickname || undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class KoishiOneBotAdapter implements CredentialAdapter {
  readonly name = 'onebot'

  constructor(
    private readonly resolveBot: () => Bot | undefined,
    readonly selfId: string,
    private readonly domain = 'user.qzone.qq.com',
  ) {}

  async getCredential(): Promise<CredentialResult> {
    const bot = this.resolveBot()
    if (!bot) {
      throw new Error(`未找到 QQ ${this.selfId} 对应的在线 OneBot 机器人`)
    }
    const internal = bot.internal as OneBotInternalLike | undefined
    if (!internal) throw new Error(`OneBot 机器人 ${this.selfId} 未暴露 internal API`)

    let cookie = ''
    let lastError: unknown
    if (typeof internal.getCookies === 'function') {
      try {
        cookie = extractCookie(await internal.getCookies(this.domain))
      } catch (error) {
        lastError = error
      }
    }
    if (!cookie && typeof internal.getCredentials === 'function') {
      try {
        cookie = extractCookie(await internal.getCredentials(this.domain))
      } catch (error) {
        lastError = error
      }
    }
    if (!cookie && typeof internal._request === 'function') {
      try {
        cookie = extractCookie(await internal._request('get_cookies', { domain: this.domain }))
      } catch (error) {
        lastError = error
      }
    }
    if (!cookie) {
      const detail = lastError ? `：${errorMessage(lastError)}` : ''
      throw new Error(`OneBot 机器人 ${this.selfId} 未返回 Qzone Cookie${detail}`)
    }

    let nickname = bot.user?.name || undefined
    if (!nickname && typeof internal.getLoginInfo === 'function') {
      try {
        nickname = extractNickname(await internal.getLoginInfo())
      } catch {
        // Login metadata is optional; the Cookie is sufficient for Qzone.
      }
    }
    return { cookie, nickname, source: this.name }
  }
}
