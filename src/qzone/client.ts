import type { QzoneSession } from './session'
import { asNumber, asRecord } from '../types'
import {
  QZONE_CODE_IMAGE_EXPIRED,
  QZONE_CODE_LOGIN_EXPIRED,
  QZONE_ERROR,
  QZONE_HTTP_STATUS_KEY,
  QZONE_META_KEY,
} from './constants'
import { parseResponse } from './parser'

export type RequestValues = Record<string, string | number | boolean | null | undefined>

export interface QzoneRequestOptions {
  params?: RequestValues
  data?: RequestValues
  headers?: Record<string, string>
  timeoutMs?: number
  /** 写操作标志：遇到登录失效（302 重定向或 code=-3000）时不重试，避免重复提交。默认 undefined 表示按读操作逻辑重试 */
  retryOnRedirect?: boolean
}

function appendValues(target: URLSearchParams, values: RequestValues): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue
    target.set(key, String(value))
  }
}

export class QzoneHttpClient {
  constructor(
    protected readonly session: QzoneSession,
    private readonly defaultTimeoutMs: number,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async request(
    method: 'GET' | 'POST',
    url: string,
    options: QzoneRequestOptions = {},
    retry = 0,
  ): Promise<Record<string, unknown>> {
    const context = await this.session.getContext()
    const target = new URL(url)
    if (options.params) appendValues(target.searchParams, options.params)

    const headers = context.headers(options.headers)
    let body: URLSearchParams | undefined
    if (options.data) {
      body = new URLSearchParams()
      appendValues(body, options.data)
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.defaultTimeoutMs,
    )

    let response: Response
    let text: string
    try {
      response = await this.fetchImpl(target, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual',
      })
      text = await response.text()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Qzone 请求超时：${target.hostname}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      if (options.retryOnRedirect === false) {
        // 写操作：302 通常表示服务端已受理（评论/回复/发布已生效），
        // 重试会导致重复提交。此处按成功处理，由调用方决定如何解读。
        return { code: 0, message: 'ok', data: {} }
      }
      if (retry >= 2) throw new Error('Qzone 接口持续返回登录重定向')
      if (retry === 0) await this.session.getContext(true)
      else await this.session.refreshAfterAuthFailure()
      return this.request(method, url, options, retry + 1)
    }

    const parsed = parseResponse(text)
    parsed[QZONE_META_KEY] = { [QZONE_HTTP_STATUS_KEY]: response.status }
    const data = asRecord(parsed.data)
    const expired = response.status === 401
      || asNumber(parsed.code) === QZONE_CODE_LOGIN_EXPIRED
      || asNumber(data.ret) === QZONE_CODE_IMAGE_EXPIRED

    if (expired) {
      if (options.retryOnRedirect === false) {
        // 写操作：QQ 空间写接口在 Cookie 过期时仍会执行成功
        // （评论/回复/点赞/发布实际已生效），但返回 code=-3000 提示登录。
        // 重试会导致重复提交，此处按成功处理，由调用方决定如何解读。
        return { code: 0, message: 'ok', data: {} }
      }
      if (retry >= 2) throw new Error('Qzone 登录状态刷新后仍然失效')
      if (retry === 0) await this.session.getContext(true)
      else await this.session.refreshAfterAuthFailure()
      return this.request(method, url, options, retry + 1)
    }

    if (response.status === 403 && asNumber(parsed.code, -1) === -1) {
      parsed.code = 403
      parsed.message = QZONE_ERROR.forbidden
    }
    return parsed
  }
}
