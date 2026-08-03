import type { Bot } from 'koishi'
import { describe, expect, it, vi } from 'vitest'

import { KoishiOneBotAdapter, OneBotHttpAdapter } from '../src/adapters/onebot'

describe('credential adapters', () => {
  it('uses the typed OneBot getCookies API exposed by Koishi', async () => {
    const getCookies = vi.fn().mockResolvedValue('uin=o10001; skey=s; p_skey=p')
    const bot = {
      selfId: '10001',
      user: { name: 'Qzone Bot' },
      internal: { getCookies },
    } as unknown as Bot

    const result = await new KoishiOneBotAdapter(() => bot).getCredential()
    expect(getCookies).toHaveBeenCalledWith('user.qzone.qq.com')
    expect(result.cookie).toContain('p_skey=p')
    expect(result.nickname).toBe('Qzone Bot')
    expect(result.source).toBe('koishi-onebot')
  })

  it('falls back to getCredentials', async () => {
    const bot = {
      selfId: '10001',
      internal: {
        getCredentials: vi.fn().mockResolvedValue({
          cookies: 'uin=o10001; skey=s; p_skey=p',
          csrf_token: 1,
        }),
      },
    } as unknown as Bot
    const result = await new KoishiOneBotAdapter(() => bot).getCredential()
    expect(result.cookie).toContain('uin=o10001')
  })

  it('calls OneBot HTTP actions with bearer authentication', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const data = url.endsWith('/get_cookies')
        ? { cookies: 'uin=o10001; skey=s; p_skey=p' }
        : { user_id: 10001, nickname: 'HTTP Bot' }
      return new Response(JSON.stringify({ status: 'ok', retcode: 0, data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const adapter = new OneBotHttpAdapter({
      baseUrl: 'http://127.0.0.1:3000',
      accessToken: 'TOKEN',
      timeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    })

    const result = await adapter.getCredential()
    expect(result.nickname).toBe('HTTP Bot')
    expect(calls[0].url).toBe('http://127.0.0.1:3000/get_cookies')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
  })

  it('rejects bearer tokens over non-loopback plaintext HTTP by default', async () => {
    const fetchMock = vi.fn()
    const adapter = new OneBotHttpAdapter({
      baseUrl: 'http://192.168.1.10:3000',
      accessToken: 'TOKEN',
      timeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    })
    await expect(adapter.getCredential()).rejects.toThrow('HTTPS')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
