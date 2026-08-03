import type { Bot, Context } from 'koishi'
import { describe, expect, it, vi } from 'vitest'

import { AutoCredentialAdapter, createCredentialAdapter } from '../src/adapters'
import { KoishiOneBotAdapter } from '../src/adapters/onebot'
import type { Config } from '../src/config'
import type { CredentialAdapter } from '../src/types'

const COOKIE = 'uin=o10001; skey=s; p_skey=p'

function fakeBot(internal: Record<string, unknown>, selfId = '10001'): Bot {
  return {
    platform: 'onebot',
    selfId,
    internal,
    user: { name: 'OneBot User' },
  } as unknown as Bot
}

describe('OneBot credential adapters', () => {
  it('loads Qzone cookies from the selected Koishi OneBot bot', async () => {
    const getCookies = vi.fn(async () => COOKIE)
    const adapter = new KoishiOneBotAdapter(
      () => fakeBot({ getCookies }),
      '10001',
    )

    await expect(adapter.getCredential()).resolves.toEqual({
      cookie: COOKIE,
      nickname: 'OneBot User',
      source: 'onebot',
    })
    expect(getCookies).toHaveBeenCalledWith('user.qzone.qq.com')
  })

  it('falls back to getCredentials when getCookies is unavailable', async () => {
    const adapter = new KoishiOneBotAdapter(
      () => fakeBot({
        getCookies: vi.fn(async () => { throw new Error('unsupported action') }),
        getCredentials: vi.fn(async () => ({ cookies: COOKIE })),
      }),
      '10001',
    )

    await expect(adapter.getCredential()).resolves.toMatchObject({
      cookie: COOKIE,
      source: 'onebot',
    })
  })

  it('supports the raw WebSocket action response as a final fallback', async () => {
    const request = vi.fn(async () => ({
      status: 'ok',
      retcode: 0,
      data: { cookies: COOKIE },
    }))
    const adapter = new KoishiOneBotAdapter(
      () => fakeBot({
        getCookies: vi.fn(async () => ''),
        _request: request,
      }),
      '10001',
    )

    await expect(adapter.getCredential()).resolves.toMatchObject({
      cookie: COOKIE,
      source: 'onebot',
    })
    expect(request).toHaveBeenCalledWith('get_cookies', {
      domain: 'user.qzone.qq.com',
    })
  })

  it('uses QR credentials when OneBot is unavailable in auto mode', async () => {
    const onebot: CredentialAdapter = {
      name: 'onebot',
      async getCredential() { throw new Error('offline') },
    }
    const qrcode: CredentialAdapter = {
      name: 'qrcode',
      async getCredential() { return { cookie: COOKIE, source: 'qrcode' } },
    }

    await expect(new AutoCredentialAdapter(onebot, qrcode).getCredential())
      .resolves.toMatchObject({ source: 'qrcode' })
  })

  it('skips a failed OneBot source once before restoring normal priority', async () => {
    const onebot: CredentialAdapter = {
      name: 'onebot',
      getCredential: vi.fn(async () => ({ cookie: COOKIE, source: 'onebot' })),
    }
    const qrcode: CredentialAdapter = {
      name: 'qrcode',
      getCredential: vi.fn(async () => ({ cookie: COOKIE, source: 'qrcode' })),
    }
    const adapter = new AutoCredentialAdapter(onebot, qrcode)

    await expect(adapter.getCredential()).resolves.toMatchObject({ source: 'onebot' })
    await adapter.invalidateCredential('onebot')
    await expect(adapter.getCredential()).resolves.toMatchObject({ source: 'qrcode' })
    await expect(adapter.getCredential()).resolves.toMatchObject({ source: 'onebot' })
  })

  it('requires a numeric OneBot QQ number outside QR-only mode', () => {
    const ctx = { bots: [] } as unknown as Context
    const qrcode: CredentialAdapter = {
      name: 'qrcode',
      async getCredential() { return { cookie: COOKIE, source: 'qrcode' } },
    }
    const config = {
      authMode: 'auto',
      onebotSelfId: '',
      commandAuthority: 1,
      adminAuthority: 3,
    } satisfies Config

    expect(() => createCredentialAdapter(ctx, config, qrcode)).toThrow('onebotSelfId')
  })

  it('does not require a OneBot QQ number in QR-only mode', () => {
    const ctx = { bots: [] } as unknown as Context
    const qrcode: CredentialAdapter = {
      name: 'qrcode',
      async getCredential() { return { cookie: COOKIE, source: 'qrcode' } },
    }
    const config: Config = {
      authMode: 'qrcode',
      commandAuthority: 1,
      adminAuthority: 3,
    }

    expect(createCredentialAdapter(ctx, config, qrcode)).toBe(qrcode)
  })
})
