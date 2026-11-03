import { describe, expect, it, vi } from 'vitest'

import {
  SnowLumaActionError,
  SnowLumaClient,
  SnowLumaTimeoutError,
} from '../src/snowluma/client'

function createClient(request: (action: string, params?: Record<string, unknown>) => Promise<unknown>, options: {
  timeoutMs?: number
  writeTimeoutMs?: number
} = {}) {
  const client = new SnowLumaClient({
    selfId: '10001',
    resolveBot: () => ({ internal: { _request: request } }),
    timeoutMs: options.timeoutMs ?? 1000,
    writeTimeoutMs: options.writeTimeoutMs,
  })
  return client
}

describe('SnowLumaClient', () => {
  it('unwraps a successful OneBot response', async () => {
    const request = vi.fn(async () => ({
      status: 'ok',
      retcode: 0,
      data: { user_id: 10001 },
    }))
    const client = createClient(request)

    await expect(client.call('get_login_info')).resolves.toEqual({ user_id: 10001 })
    expect(request).toHaveBeenCalledWith('get_login_info', {})
  })

  it('returns raw data when the adapter already unwrapped the response', async () => {
    const client = createClient(async () => ({ user_id: 10001 }))
    await expect(client.call('get_login_info')).resolves.toEqual({ user_id: 10001 })
  })

  it('rejects non-zero retcode with the action name', async () => {
    const client = createClient(async () => ({
      status: 'failed',
      retcode: 1200,
      message: 'not logged in',
    }))

    await expect(client.call('like_qzone', { tid: 'x' }, { write: true }))
      .rejects.toThrow('QQ 空间接口 like_qzone 调用失败：not logged in')
    await expect(client.call('like_qzone', {}, { write: true }))
      .rejects.toBeInstanceOf(SnowLumaActionError)
  })

  it('reports the SnowLuma connection requirement when the bot is missing', async () => {
    const client = new SnowLumaClient({
      selfId: '10001',
      resolveBot: () => undefined,
      timeoutMs: 1000,
    })
    await expect(client.call('get_login_info'))
      .rejects.toThrow('未找到 OneBot 机器人 10001，请确认 SnowLuma 已连接')
  })

  it('warns that a timed-out write may still have taken effect', async () => {
    const client = createClient(() => new Promise(() => {}), { timeoutMs: 5, writeTimeoutMs: 5 })

    await expect(client.call('comment_qzone', { tid: 'x', content: 'hi' }, { write: true }))
      .rejects.toThrow('结果可能已经生效，请先确认后再决定是否重试。')
    await expect(client.call('get_login_info', {}, { timeoutMs: 5 }))
      .rejects.toBeInstanceOf(SnowLumaTimeoutError)
  })
})
