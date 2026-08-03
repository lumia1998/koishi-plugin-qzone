import { describe, expect, it } from 'vitest'

import { parseCookieString, parseCredentials, QzoneContext } from '../src/qzone/context'

describe('QzoneContext', () => {
  it('parses complete cookie values without losing equals signs', () => {
    const cookies = parseCookieString('uin=o123456; skey=abc==; p_skey=token; empty=')
    expect(cookies.get('uin')).toBe('o123456')
    expect(cookies.get('skey')).toBe('abc==')
    expect(cookies.get('empty')).toBe('')
  })

  it('normalizes credentials and computes g_tk', () => {
    const credentials = parseCredentials('uin=o123456; skey=s; p_skey=abc', 'test')
    const context = new QzoneContext(credentials)
    expect(context.uin).toBe('123456')
    expect(context.gtk2).toBe('193485963')
    expect(context.headers().Cookie).toContain('p_skey=abc')
  })

  it('falls back to skey when p_skey is absent', () => {
    const credentials = parseCredentials('p_uin=o42; skey=fallback', 'manual')
    expect(credentials.uin).toBe('42')
    expect(credentials.pSkey).toBe('fallback')
    expect(credentials.cookie).toContain('uin=o42')
  })

  it('rejects incomplete cookies', () => {
    expect(() => parseCredentials('skey=x', 'manual')).toThrow('uin')
    expect(() => parseCredentials('uin=o123', 'manual')).toThrow('p_skey')
  })
})
