import { describe, expect, it, vi } from 'vitest'

import type { CredentialAdapter } from '../src/types'
import { QzoneHttpClient } from '../src/qzone/client'
import { QzoneSession } from '../src/qzone/session'

describe('QzoneHttpClient', () => {
  it('refreshes credentials and retries on explicit login expiration', async () => {
    let credentialCalls = 0
    const invalidateCredential = vi.fn(async () => undefined)
    const adapter: CredentialAdapter = {
      name: 'test',
      invalidateCredential,
      async getCredential() {
        credentialCalls += 1
        return {
          cookie: `uin=o10001; skey=s; p_skey=p${credentialCalls}`,
          source: 'test',
        }
      },
    }
    let requestCalls = 0
    const fetchMock = vi.fn(async () => {
      requestCalls += 1
      const payload = requestCalls === 1
        ? { code: -3000, message: 'expired', data: {} }
        : { code: 0, data: { value: 1 } }
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    const client = new QzoneHttpClient(
      new QzoneSession(adapter, 600),
      1000,
      fetchMock as typeof fetch,
    )

    const result = await client.request('GET', 'https://user.qzone.qq.com/test')
    expect(result.code).toBe(0)
    expect(requestCalls).toBe(2)
    expect(credentialCalls).toBe(2)
    expect(invalidateCredential).not.toHaveBeenCalled()
  })

  it('maps empty 403 responses to a permission error', async () => {
    const adapter: CredentialAdapter = {
      name: 'test',
      async getCredential() {
        return { cookie: 'uin=o10001; skey=s; p_skey=p', source: 'test' }
      },
    }
    const client = new QzoneHttpClient(
      new QzoneSession(adapter, 600),
      1000,
      vi.fn(async () => new Response('', { status: 403 })) as typeof fetch,
    )
    const result = await client.request('GET', 'https://user.qzone.qq.com/test')
    expect(result).toMatchObject({ code: 403, message: '权限不足' })
  })

  it('adapts the known Qzone proxy HTML response only for opted-in writes', async () => {
    const adapter: CredentialAdapter = {
      name: 'test',
      async getCredential() {
        return { cookie: 'uin=o10001; skey=s; p_skey=p', source: 'test' }
      },
    }
    const html = '<html><head><meta charset="UTF-8"></head><body><script>document.domain="user.qzone.qq.com"</script></body></html>'
    const plainHtml = '<html><head><meta charset="UTF-8"></head><body>accepted</body></html>'
    let requestCalls = 0
    const fetchMock = vi.fn(async () => {
      requestCalls += 1
      return new Response(requestCalls === 1 ? html : plainHtml, { status: 200 })
    }) as typeof fetch
    const client = new QzoneHttpClient(
      new QzoneSession(adapter, 600),
      1000,
      fetchMock,
    )

    const accepted = await client.request('POST', 'https://user.qzone.qq.com/comment', {
      data: { content: 'hello' },
      retryOnRedirect: false,
      acceptQzoneProxyHtml: true,
    })
    expect(accepted).toMatchObject({
      code: 0,
      message: 'accepted',
      data: { responseUncertain: true },
    })

    const rejected = await client.request('GET', 'https://user.qzone.qq.com/feed')
    expect(rejected).toMatchObject({
      code: -1,
      message: expect.stringContaining('响应内容格式异常'),
    })

    const genericResponse = await client.request('POST', 'https://user.qzone.qq.com/comment', {
      data: { content: 'hello' },
      retryOnRedirect: false,
      acceptQzoneProxyHtml: true,
    })
    expect(genericResponse).toMatchObject({
      code: -1,
      message: expect.stringContaining('响应内容格式异常'),
    })
  })

  it('never follows redirects while carrying Qzone cookies', async () => {
    const adapter: CredentialAdapter = {
      name: 'test',
      async getCredential() {
        return { cookie: 'uin=o10001; skey=s; p_skey=p', source: 'test' }
      },
    }
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual')
      return new Response('', {
        status: 302,
        headers: { Location: 'https://example.invalid/steal' },
      })
    })
    const client = new QzoneHttpClient(
      new QzoneSession(adapter, 600),
      1000,
      fetchMock as typeof fetch,
    )
    await expect(client.request('GET', 'https://user.qzone.qq.com/test'))
      .rejects.toThrow('登录重定向')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
