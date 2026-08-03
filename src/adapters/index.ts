import type { Bot } from 'koishi'

import type { Config } from '../config'
import type { AuthMode, CredentialAdapter, CredentialResult } from '../types'
import { ManualCookieAdapter } from './manual'
import { KoishiOneBotAdapter, OneBotHttpAdapter } from './onebot'

class FallbackCredentialAdapter implements CredentialAdapter {
  readonly name = 'auto'

  constructor(private readonly adapters: CredentialAdapter[]) {}

  async getCredential(): Promise<CredentialResult> {
    const failedAdapters: string[] = []
    for (const adapter of this.adapters) {
      try {
        return await adapter.getCredential()
      } catch {
        failedAdapters.push(adapter.name)
      }
    }
    throw new Error(`所有认证适配器均失败：${failedAdapters.join('、')}`)
  }
}

export function createCredentialAdapter(
  config: Config,
  resolveBot: () => Bot | undefined,
): CredentialAdapter {
  const adapters: Record<Exclude<AuthMode, 'auto'>, CredentialAdapter> = {
    onebot: new KoishiOneBotAdapter(resolveBot),
    'onebot-http': new OneBotHttpAdapter({
      baseUrl: config.onebotHttpUrl,
      accessToken: config.onebotAccessToken,
      allowInsecure: config.allowInsecureOnebotHttp,
      timeoutMs: config.timeoutMs,
    }),
    manual: new ManualCookieAdapter(config.manualCookie),
  }

  if (config.authMode !== 'auto') return adapters[config.authMode]

  const candidates = [adapters.onebot]
  if (config.onebotHttpUrl.trim()) candidates.push(adapters['onebot-http'])
  if (config.manualCookie.trim()) candidates.push(adapters.manual)
  return new FallbackCredentialAdapter(candidates)
}
