import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import JSON5 from 'json5'
import { CookieJar } from 'tough-cookie'
import { fetch as undiciFetch } from 'undici'

import type { CredentialAdapter, CredentialResult } from '../types'
import { parseCookieString, parseCredentials } from '../qzone/context'

const APP_ID = '549000912'
const DAID = '5'
const LOGIN_SUCCESS_URL = 'https://qzs.qq.com/qzone/v5/loginsucc.html'
const QZONE_COOKIE_URL = 'https://user.qzone.qq.com/'
const XLOGIN_URL = 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin'
const QR_SHOW_URL = 'https://ssl.ptlogin2.qq.com/ptqrshow'
const QR_POLL_URL = 'https://ssl.ptlogin2.qq.com/ptqrlogin'
const MAX_QR_BYTES = 1024 * 1024
const MAX_LOGIN_REDIRECTS = 5
const ALLOWED_LOGIN_HOSTS = new Set([
  'ptlogin2.qzone.qq.com',
  'ptlogin2.qq.com',
  'qzone.qq.com',
  'qzs.qq.com',
  'ssl.ptlogin2.qq.com',
  'user.qzone.qq.com',
  'xui.ptlogin2.qq.com',
])
const USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/138.0.0.0 Safari/537.36',
].join(' ')

type QrLoginStatus = 'waiting' | 'scanned'

export interface QrLoginChallenge {
  image: Buffer
  contentType: string
  expiresAt: number
}

export interface QrLoginCallbacks {
  onQrCode(challenge: QrLoginChallenge): Promise<void> | void
  onStatus?(status: QrLoginStatus): Promise<void> | void
}

export interface QrCodeCredentialAdapterOptions {
  credentialPath: string
  timeoutMs: number
  loginTimeoutSeconds: number
  pollIntervalMs: number
  fetch?: typeof globalThis.fetch
  now?: () => number
  random?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export interface PtuiCallback {
  code: string
  redirectUrl: string
  message: string
  nickname?: string
}

interface StoredCredential {
  version: 1
  cookie: string
  nickname?: string
  savedAt: number
}

interface ActiveLogin {
  controller: AbortController
  promise: Promise<CredentialResult>
}

export class QrLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QrLoginError'
  }
}

export class QrLoginRequiredError extends QrLoginError {
  constructor(message = '尚未保存扫码凭据，请私聊机器人执行 qzone.login。') {
    super(message)
    this.name = 'QrLoginRequiredError'
  }
}

export function hash33(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) % 0x80000000
  }
  return hash
}

export function parsePtuiCallback(source: string): PtuiCallback {
  const match = /^\s*ptuiCB\s*\(([\s\S]*)\)\s*;?\s*$/.exec(source)
  if (!match) throw new QrLoginError('QQ 登录响应格式异常。')

  let values: unknown
  try {
    values = JSON5.parse(`[${match[1]}]`)
  } catch {
    throw new QrLoginError('QQ 登录响应格式异常。')
  }
  if (!Array.isArray(values) || values.length < 5) {
    throw new QrLoginError('QQ 登录响应字段不完整。')
  }
  return {
    code: String(values[0] ?? ''),
    redirectUrl: String(values[2] ?? ''),
    message: String(values[4] ?? ''),
    nickname: values[5] === undefined ? undefined : String(values[5]),
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof extended.getSetCookie === 'function') return extended.getSetCookie()
  const combined = headers.get('set-cookie')
  if (!combined) return []
  return combined.split(/,(?=\s*[^;,\s=]+=[^;,]*)/g)
}

function assertAllowedLoginUrl(url: URL): void {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new QrLoginError('QQ 登录返回了不安全的跳转地址。')
  }
  if (!ALLOWED_LOGIN_HOSTS.has(hostname)) {
    throw new QrLoginError('QQ 登录返回了未授权的跳转地址。')
  }
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new QrLoginError('二维码登录已取消。'))
      return
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', cancel, { once: true })

    function finish(): void {
      signal.removeEventListener('abort', cancel)
      resolve()
    }

    function cancel(): void {
      clearTimeout(timer)
      reject(new QrLoginError('二维码登录已取消。'))
    }
  })
}

class FileCredentialStore {
  private loaded = false
  private credential?: CredentialResult

  constructor(private readonly path: string) {}

  async get(): Promise<CredentialResult | undefined> {
    if (this.loaded) return this.copy()
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredCredential>
      if (parsed.version !== 1 || typeof parsed.cookie !== 'string') {
        throw new QrLoginRequiredError('本地扫码凭据格式无效，请重新执行 qzone.login。')
      }
      const normalized = parseCredentials(parsed.cookie, 'qrcode', parsed.nickname)
      this.credential = {
        cookie: normalized.cookie,
        nickname: normalized.nickname,
        source: 'qrcode',
      }
      return this.copy()
    } catch (error) {
      this.loaded = false
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      if (error instanceof QrLoginError) throw error
      throw new QrLoginRequiredError('本地扫码凭据无法读取，请重新执行 qzone.login。')
    }
  }

  async set(result: CredentialResult): Promise<CredentialResult> {
    const normalized = parseCredentials(result.cookie, 'qrcode', result.nickname)
    const credential: CredentialResult = {
      cookie: normalized.cookie,
      nickname: normalized.nickname,
      source: 'qrcode',
    }
    const stored: StoredCredential = {
      version: 1,
      cookie: credential.cookie,
      nickname: credential.nickname,
      savedAt: Date.now(),
    }
    const parent = dirname(this.path)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 })
      await chmod(parent, 0o700).catch(() => undefined)
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await rename(temporary, this.path)
      await chmod(this.path, 0o600).catch(() => undefined)
      this.credential = credential
      this.loaded = true
      return this.copy() as CredentialResult
    } catch {
      throw new QrLoginError('二维码登录成功，但本地凭据保存失败。')
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async clear(): Promise<void> {
    this.loaded = true
    this.credential = undefined
    try {
      await rm(this.path, { force: true })
    } catch {
      throw new QrLoginError('本地扫码凭据清理失败。')
    }
  }

  private copy(): CredentialResult | undefined {
    return this.credential ? { ...this.credential } : undefined
  }
}

export class QrCodeCredentialAdapter implements CredentialAdapter {
  readonly name = 'qrcode'
  private readonly store: FileCredentialStore
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private readonly random: () => number
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  private active?: ActiveLogin

  constructor(private readonly options: QrCodeCredentialAdapterOptions) {
    this.store = new FileCredentialStore(options.credentialPath)
    this.fetchImpl = (options.fetch || undiciFetch) as unknown as typeof globalThis.fetch
    this.now = options.now || Date.now
    this.random = options.random || Math.random
    this.sleep = options.sleep || defaultSleep
  }

  async getCredential(): Promise<CredentialResult> {
    const credential = await this.store.get()
    if (!credential) throw new QrLoginRequiredError()
    return credential
  }

  async invalidateCredential(source?: string): Promise<void> {
    if (!source || source === this.name) await this.store.clear()
  }

  async login(callbacks: QrLoginCallbacks): Promise<CredentialResult> {
    if (this.active) throw new QrLoginError('已有二维码登录正在进行，请先等待或使用 qzone.login --cancel。')
    const controller = new AbortController()
    const promise = this.performLogin(callbacks, controller.signal)
    this.active = { controller, promise }
    try {
      return await promise
    } finally {
      if (this.active?.promise === promise) this.active = undefined
    }
  }

  cancelLogin(): boolean {
    if (!this.active) return false
    this.active.controller.abort()
    return true
  }

  async clearCredential(): Promise<void> {
    const active = this.active?.promise
    this.cancelLogin()
    await active?.catch(() => undefined)
    await this.store.clear()
  }

  async dispose(): Promise<void> {
    const active = this.active?.promise
    this.cancelLogin()
    await active?.catch(() => undefined)
  }

  private async performLogin(
    callbacks: QrLoginCallbacks,
    signal: AbortSignal,
  ): Promise<CredentialResult> {
    const jar = new CookieJar()
    const loginSig = await this.initializeLogin(jar, signal)
    const challenge = await this.fetchQrCode(jar, signal)
    await callbacks.onQrCode(challenge)
    const result = await this.pollLogin(jar, loginSig, challenge.expiresAt, callbacks, signal)
    return this.store.set(result)
  }

  private async initializeLogin(jar: CookieJar, signal: AbortSignal): Promise<string> {
    const url = new URL(XLOGIN_URL)
    url.search = new URLSearchParams({
      appid: APP_ID,
      daid: DAID,
      style: '33',
      s_url: 'https://qzone.qq.com/',
    }).toString()
    const response = await this.request(url, jar, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    }, signal)
    if (!response.ok) throw new QrLoginError('QQ 登录初始化失败。')
    return parseCookieString(await jar.getCookieString(url.href)).get('pt_login_sig') || ''
  }

  private async fetchQrCode(jar: CookieJar, signal: AbortSignal): Promise<QrLoginChallenge> {
    const url = new URL(QR_SHOW_URL)
    url.search = new URLSearchParams({
      appid: APP_ID,
      e: '2',
      l: 'M',
      s: '3',
      d: '72',
      v: '4',
      t: String(this.random()),
      daid: DAID,
      pt_3rd_aid: '0',
      u1: LOGIN_SUCCESS_URL,
    }).toString()
    const response = await this.request(url, jar, {
      headers: { Accept: 'image/*', Referer: `${XLOGIN_URL}?appid=${APP_ID}` },
    }, signal)
    if (!response.ok) throw new QrLoginError('QQ 登录二维码获取失败。')
    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0]
    if (!contentType.startsWith('image/')) throw new QrLoginError('QQ 登录二维码响应类型异常。')
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_QR_BYTES) throw new QrLoginError('QQ 登录二维码响应过大。')
    const image = Buffer.from(await response.arrayBuffer())
    if (!image.length || image.length > MAX_QR_BYTES) {
      throw new QrLoginError('QQ 登录二维码内容无效。')
    }

    const cookies = parseCookieString(await jar.getCookieString(url.href))
    if (!cookies.get('qrsig')) throw new QrLoginError('QQ 登录二维码缺少 qrsig。')
    return {
      image,
      contentType,
      expiresAt: this.now() + (this.options.loginTimeoutSeconds || 120) * 1000,
    }
  }

  private async pollLogin(
    jar: CookieJar,
    loginSig: string,
    expiresAt: number,
    callbacks: QrLoginCallbacks,
    signal: AbortSignal,
  ): Promise<CredentialResult> {
    const qrCookies = parseCookieString(await jar.getCookieString(QR_SHOW_URL))
    const qrsig = qrCookies.get('qrsig') || ''
    if (!qrsig) throw new QrLoginError('QQ 登录二维码状态丢失。')

    let previousStatus: QrLoginStatus | undefined
    while (this.now() < expiresAt) {
      const url = new URL(QR_POLL_URL)
      url.search = new URLSearchParams({
        u1: LOGIN_SUCCESS_URL,
        ptqrtoken: String(hash33(qrsig)),
        ptredirect: '0',
        h: '1',
        t: '1',
        g: '1',
        from_ui: '1',
        ptlang: '2052',
        action: `0-0-${this.now()}`,
        js_ver: '20032614',
        js_type: '1',
        login_sig: loginSig,
        pt_uistyle: '40',
        aid: APP_ID,
        daid: DAID,
      }).toString()
      const response = await this.request(url, jar, {
        headers: { Accept: 'text/html,*/*', Referer: `${XLOGIN_URL}?appid=${APP_ID}` },
      }, signal)
      if (!response.ok) throw new QrLoginError('QQ 登录状态查询失败。')
      const result = parsePtuiCallback(await response.text())

      if (result.code === '0') {
        if (!result.redirectUrl) throw new QrLoginError('QQ 登录成功响应缺少跳转地址。')
        await this.followLoginRedirects(new URL(result.redirectUrl), jar, signal)
        const cookie = await jar.getCookieString(QZONE_COOKIE_URL)
        const normalized = parseCredentials(cookie, this.name, result.nickname)
        return {
          cookie: normalized.cookie,
          nickname: normalized.nickname,
          source: this.name,
        }
      }
      if (result.code === '65') throw new QrLoginError('二维码已过期，请重新执行 qzone.login。')
      if (result.code === '68') throw new QrLoginError('二维码登录已取消或过期。')

      const status: QrLoginStatus = result.code === '67' ? 'scanned' : 'waiting'
      if (!['66', '67'].includes(result.code)) {
        throw new QrLoginError('QQ 返回了未知的二维码登录状态。')
      }
      if (status !== previousStatus) {
        previousStatus = status
        await callbacks.onStatus?.(status)
      }
      await this.sleep(this.options.pollIntervalMs || 2000, signal)
    }
    throw new QrLoginError('二维码已超时，请重新执行 qzone.login。')
  }

  private async followLoginRedirects(
    initialUrl: URL,
    jar: CookieJar,
    signal: AbortSignal,
  ): Promise<void> {
    let url = initialUrl
    for (let count = 0; count <= MAX_LOGIN_REDIRECTS; count += 1) {
      assertAllowedLoginUrl(url)
      const response = await this.request(url, jar, {
        headers: { Accept: 'text/html,application/xhtml+xml', Referer: `${XLOGIN_URL}?appid=${APP_ID}` },
      }, signal)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new QrLoginError('QQ 登录跳转缺少 Location。')
        if (count === MAX_LOGIN_REDIRECTS) throw new QrLoginError('QQ 登录跳转次数过多。')
        url = new URL(location, url)
        continue
      }
      if (!response.ok) throw new QrLoginError('QQ 登录确认请求失败。')
      return
    }
  }

  private async request(
    url: URL,
    jar: CookieJar,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (signal.aborted) controller.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs || 10000)

    try {
      const headers = new Headers(init.headers)
      headers.set('User-Agent', USER_AGENT)
      const cookie = await jar.getCookieString(url.href)
      if (cookie) headers.set('Cookie', cookie)
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: 'manual',
      })
      for (const value of getSetCookieHeaders(response.headers)) {
        await jar.setCookie(value, url.href, { ignoreError: true })
      }
      return response
    } catch (error) {
      if (signal.aborted) throw new QrLoginError('二维码登录已取消。')
      if (error instanceof Error && error.name === 'AbortError') {
        throw new QrLoginError('QQ 登录请求超时。')
      }
      if (error instanceof QrLoginError) throw error
      throw new QrLoginError('QQ 登录网络请求失败。')
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', forwardAbort)
    }
  }
}
