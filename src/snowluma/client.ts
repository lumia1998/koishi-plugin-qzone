import type { Logger } from 'koishi'

import { asRecord, asString } from '../types'

export interface OneBotRequestTarget {
  internal?: {
    _request?: (action: string, params?: Record<string, unknown>) => Promise<unknown>
  }
}

export interface SnowLumaClientOptions {
  selfId: string
  resolveBot(): OneBotRequestTarget | undefined
  timeoutMs: number
  writeTimeoutMs?: number
  logger?: Logger
  debugLogging?: boolean
}

export interface SnowLumaCallOptions {
  /** 写操作超时时结果可能已经生效，错误文案会特别提示不要盲目重试。 */
  write?: boolean
  timeoutMs?: number
}

export class SnowLumaActionError extends Error {
  constructor(
    readonly action: string,
    message: string,
    readonly retcode?: number,
  ) {
    super(message)
    this.name = 'SnowLumaActionError'
  }
}

export class SnowLumaTimeoutError extends Error {
  constructor(
    readonly action: string,
    readonly write: boolean,
  ) {
    super(write
      ? `QQ 空间写操作超时（${action}），结果可能已经生效，请先确认后再决定是否重试。`
      : `QQ 空间请求超时（${action}）。`)
    this.name = 'SnowLumaTimeoutError'
  }
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if ('retcode' in record) return true
  return record.status === 'ok' || record.status === 'failed' || record.status === 'async'
}

function unwrap(value: unknown): unknown {
  if (!isEnvelope(value)) return value
  const status = asString(value.status)
  const retcode = typeof value.retcode === 'number' ? value.retcode : undefined
  if (status === 'failed' || (retcode !== undefined && retcode !== 0)) {
    const message = asString(value.wording || value.message, `retcode=${retcode ?? 'unknown'}`)
    throw new SnowLumaActionError('<response>', message, retcode)
  }
  return value.data
}

/**
 * 通过已连接的 OneBot 适配器调用 SnowLuma 的 QQ 空间 Action。
 *
 * SnowLuma 的 WebSocket 动作名与 HTTP API 相同。OneBot 适配器可能：
 * - 直接返回 Action 的 `data`；
 * - 返回完整的 `{ status, retcode, data, message }` 响应。
 * 两种情况都在这里统一处理，并且严格要求 `retcode === 0`。
 */
export class SnowLumaClient {
  constructor(private readonly options: SnowLumaClientOptions) {}

  async call<T = unknown>(
    action: string,
    params: Record<string, unknown> = {},
    callOptions: SnowLumaCallOptions = {},
  ): Promise<T> {
    const bot = this.options.resolveBot()
    if (!bot) {
      throw new Error(`未找到 OneBot 机器人 ${this.options.selfId}，请确认 SnowLuma 已连接`)
    }
    const request = bot.internal?._request
    if (typeof request !== 'function') {
      throw new Error('当前 OneBot 适配器不支持 _request，无法调用 SnowLuma QQ 空间动作')
    }

    if (this.options.debugLogging) {
      this.options.logger?.debug('[qzone] SnowLuma action=%s keys=%s', action, Object.keys(params).join(','))
    }

    const pending = Promise.resolve().then(() => request.call(bot.internal, action, params))
    // 超时后原始 Promise 可能仍会失败；提前挂接 catch，避免 unhandled rejection。
    pending.catch(() => undefined)

    let raw: unknown
    try {
      raw = await this.withTimeout(
        pending,
        callOptions.timeoutMs ?? (callOptions.write
          ? this.options.writeTimeoutMs ?? this.options.timeoutMs
          : this.options.timeoutMs),
        action,
        Boolean(callOptions.write),
      )
    } catch (error) {
      if (error instanceof SnowLumaTimeoutError) throw error
      throw this.normalizeError(action, error)
    }

    try {
      return unwrap(raw) as T
    } catch (error) {
      if (error instanceof SnowLumaActionError) {
        throw new SnowLumaActionError(action, `QQ 空间接口 ${action} 调用失败：${error.message}`, error.retcode)
      }
      throw error
    }
  }

  private withTimeout<T>(
    pending: Promise<T>,
    timeoutMs: number,
    action: string,
    write: boolean,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SnowLumaTimeoutError(action, write)), Math.max(1, timeoutMs))
      if (typeof timer.unref === 'function') timer.unref()
    })
    return Promise.race([pending, timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  private normalizeError(action: string, error: unknown): Error {
    if (error instanceof SnowLumaActionError) return error
    const record = asRecord(error)
    const detail = asString(record.wording || record.message)
      || (error instanceof Error ? error.message : String(error || '未知错误'))
    return new SnowLumaActionError(action, `QQ 空间接口 ${action} 调用失败：${detail}`)
  }
}

export function unwrapSnowLumaResponse(value: unknown): unknown {
  return unwrap(value)
}
