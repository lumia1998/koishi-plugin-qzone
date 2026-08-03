import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  QrCodeCredentialAdapter,
  hash33,
  parsePtuiCallback,
} from '../src/adapters/qrcode'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })))
})

async function credentialPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'koishi-qzone-qr-'))
  temporaryDirectories.push(directory)
  return join(directory, 'credentials.json')
}

function response(
  body: BodyInit | null,
  init: ResponseInit = {},
  cookies: string[] = [],
): Response {
  const headers = new Headers(init.headers)
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(body, { ...init, headers })
}

describe('QQ QR login protocol', () => {
  it('calculates the ptqrtoken hash33 value', () => {
    expect(hash33('')).toBe(0)
    expect(hash33('abc')).toBe(108966)
    expect(hash33('qrsig-test')).toBe(1341976211)
    expect(hash33('!@#')).toBe(38084)
  })

  it('parses ptuiCB without evaluating callback code', () => {
    expect(parsePtuiCallback("ptuiCB('67','0','','0','已扫码','Nick');")).toEqual({
      code: '67',
      redirectUrl: '',
      message: '已扫码',
      nickname: 'Nick',
    })
    expect(() => parsePtuiCallback('alert(1)')).toThrow('格式异常')
    expect(() => parsePtuiCallback("ptuiCB('66')")).toThrow('字段不完整')
  })

  it('logs in, merges redirect cookies, and reloads the persisted credential', async () => {
    const path = await credentialPath()
    const statuses: string[] = []
    const calls: Array<{ url: URL, cookie: string, redirect?: RequestRedirect }> = []
    let pollCount = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      calls.push({
        url,
        cookie: headers.get('cookie') || '',
        redirect: init?.redirect,
      })
      if (url.pathname === '/cgi-bin/xlogin') {
        return response('', { status: 200 }, [
          'pt_login_sig=login-signature; Path=/; Secure; HttpOnly',
        ])
      }
      if (url.pathname === '/ptqrshow') {
        return response('qr-image', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }, [
          'qrsig=qrsig-test; Domain=.ptlogin2.qq.com; Path=/; Secure; HttpOnly',
        ])
      }
      if (url.pathname === '/ptqrlogin') {
        pollCount += 1
        if (pollCount === 1) return response("ptuiCB('66','0','','0','等待扫码','');")
        if (pollCount === 2) return response("ptuiCB('67','0','','0','已扫码','');")
        return response(
          "ptuiCB('0','0','https://ptlogin2.qzone.qq.com/check_sig?uin=10001','0','登录成功','QR User');",
          {},
          [
            'uin=o10001; Domain=.qq.com; Path=/; Secure',
            'skey=s-key-value; Domain=.qq.com; Path=/; Secure; HttpOnly',
          ],
        )
      }
      if (url.pathname === '/check_sig') {
        return response('', {
          status: 302,
          headers: { Location: 'https://qzs.qq.com/qzone/v5/loginsucc.html' },
        }, [
          'p_skey=p-key=value; Domain=.qzone.qq.com; Path=/; Secure; HttpOnly',
        ])
      }
      if (url.pathname === '/qzone/v5/loginsucc.html') return response('ok')
      throw new Error(`unexpected request: ${url.hostname}${url.pathname}`)
    })
    const adapter = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1,
      fetch: fetchMock as typeof fetch,
      random: () => 0.5,
      sleep: async () => undefined,
    })

    const result = await adapter.login({
      onQrCode(challenge) {
        expect(challenge.contentType).toBe('image/png')
        expect(challenge.image.toString()).toBe('qr-image')
      },
      onStatus(status) {
        statuses.push(status)
      },
    })

    expect(statuses).toEqual(['waiting', 'scanned'])
    expect(result).toMatchObject({ source: 'qrcode', nickname: 'QR User' })
    expect(result.cookie).toContain('uin=o10001')
    expect(result.cookie).toContain('p_skey=p-key=value')
    const pollCalls = calls.filter(({ url }) => url.pathname === '/ptqrlogin')
    expect(pollCalls).toHaveLength(3)
    expect(pollCalls[0].url.searchParams.get('ptqrtoken')).toBe('1341976211')
    expect(pollCalls[0].url.searchParams.get('login_sig')).toBe('login-signature')
    expect(pollCalls[0].cookie).toContain('qrsig=qrsig-test')
    expect(calls.every(({ redirect }) => redirect === 'manual')).toBe(true)

    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(persisted).toMatchObject({ version: 1, nickname: 'QR User' })
    const reloaded = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1000,
      fetch: vi.fn() as typeof fetch,
    })
    expect(await reloaded.getCredential()).toEqual(result)
  })

  it('rejects login redirects outside the exact QQ login host allowlist', async () => {
    const path = await credentialPath()
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/cgi-bin/xlogin') return response('')
      if (url.pathname === '/ptqrshow') {
        return response('qr', { headers: { 'Content-Type': 'image/png' } }, [
          'qrsig=test; Domain=.ptlogin2.qq.com; Path=/; Secure',
        ])
      }
      if (url.pathname === '/ptqrlogin') {
        return response("ptuiCB('0','0','https://attacker.qq.com/steal','0','ok','');", {}, [
          'uin=o10001; Domain=.qq.com; Path=/; Secure',
          'p_skey=p; Domain=.qzone.qq.com; Path=/; Secure',
        ])
      }
      throw new Error('external redirect was followed')
    })
    const adapter = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1,
      fetch: fetchMock as typeof fetch,
      sleep: async () => undefined,
    })
    await expect(adapter.login({ onQrCode() {} })).rejects.toThrow('未授权')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports an expired QR code and supports clearing stored credentials', async () => {
    const path = await credentialPath()
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/cgi-bin/xlogin') return response('')
      if (url.pathname === '/ptqrshow') {
        return response('qr', { headers: { 'Content-Type': 'image/png' } }, [
          'qrsig=test; Domain=.ptlogin2.qq.com; Path=/; Secure',
        ])
      }
      return response("ptuiCB('65','0','','0','二维码已失效','');")
    })
    const adapter = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1,
      fetch: fetchMock as typeof fetch,
    })
    await expect(adapter.login({ onQrCode() {} })).rejects.toThrow('二维码已过期')
    await expect(adapter.getCredential()).rejects.toThrow('qzone.login')
    await expect(adapter.clearCredential()).resolves.toBeUndefined()
  })

  it('cancels an active QR login', async () => {
    const path = await credentialPath()
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/cgi-bin/xlogin') return response('')
      if (url.pathname === '/ptqrshow') {
        return response('qr', { headers: { 'Content-Type': 'image/png' } }, [
          'qrsig=test; Domain=.ptlogin2.qq.com; Path=/; Secure',
        ])
      }
      return response("ptuiCB('66','0','','0','等待扫码','');")
    })
    const adapter = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1000,
      fetch: fetchMock as typeof fetch,
    })
    const login = adapter.login({
      onQrCode() {
        expect(adapter.cancelLogin()).toBe(true)
      },
    })
    await expect(login).rejects.toThrow('已取消')
    expect(adapter.cancelLogin()).toBe(false)
  })

  it('rejects a second login while a QR session is active', async () => {
    const path = await credentialPath()
    let notifyQrShown: () => void = () => undefined
    const qrShown = new Promise<void>((resolve) => {
      notifyQrShown = resolve
    })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/cgi-bin/xlogin') return response('')
      if (url.pathname === '/ptqrshow') {
        return response('qr', { headers: { 'Content-Type': 'image/png' } }, [
          'qrsig=test; Domain=.ptlogin2.qq.com; Path=/; Secure',
        ])
      }
      return response("ptuiCB('66','0','','0','等待扫码','');")
    })
    const adapter = new QrCodeCredentialAdapter({
      credentialPath: path,
      timeoutMs: 1000,
      loginTimeoutSeconds: 60,
      pollIntervalMs: 1000,
      fetch: fetchMock as typeof fetch,
    })
    const first = adapter.login({ onQrCode: notifyQrShown })
    await qrShown
    await expect(adapter.login({ onQrCode() {} })).rejects.toThrow('已有二维码登录')
    adapter.cancelLogin()
    await expect(first).rejects.toThrow('已取消')
  })
})
