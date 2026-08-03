import type { Bot } from 'koishi'

import type { Config } from '../config'
import type { AuthMode, CredentialAdapter, CredentialResult } from '../types'
import { ManualCookieAdapter } from './manual'
import { KoishiOneBotAdapter, OneBotHttpAdapter } from './onebot'
import { QrLoginRequiredError } from './qrcode'

class FallbackCredentialAdapter implements CredentialAdapter {
  readonly name = 'auto'

  constructor(private readonly adapters: CredentialAdapter[]) {}

  async getCredential(): Promise<CredentialResult> {
    const failedAdapters: string[] = []
    let loginRequired: QrLoginRequiredError | undefined
    for (const adapter of this.adapters) {
      try {
        return await adapter.getCredential()
      } catch (error) {
        if (error instanceof QrLoginRequiredError) loginRequired = error
        failedAdapters.push(adapter.name)
      }
    }
    if (loginRequired) throw loginRequired
    throw new Error(`所有认证适配器均失败：${failedAdapters.join('、')}`)
  }

  async invalidateCredential(source?: string): Promise<void> {
    const adapter = this.adapters.find((candidate) => candidate.name === source)
    await adapter?.invalidateCredential?.(source)
  }
}

export function createCredentialAdapter(
  config: Config,
  resolveBot: () => Bot | undefined,
  qrCodeAdapter: CredentialAdapter,
): CredentialAdapter {
  const adapters: Record<Exclude<AuthMode, 'auto'>, CredentialAdapter> = {
    onebot: new KoishiOneBotAdapter(resolveBot),
    'onebot-http': new OneBotHttpAdapter({
      baseUrl: config.onebotHttpUrl,
      accessToken: config.onebotAccessToken,
      allowInsecure: config.allowInsecureOnebotHttp,
      timeoutMs: config.timeoutMs,
    }),
    qrcode: qrCodeAdapter,
    manual: new ManualCookieAdapter(config.manualCookie),
  }

  if (config.authMode !== 'auto') return adapters[config.authMode]

  const candidates = [adapters.onebot]
  if (config.onebotHttpUrl.trim()) candidates.push(adapters['onebot-http'])
  candidates.push(adapters.qrcode)
  if (config.manualCookie.trim()) candidates.push(adapters.manual)
  return new FallbackCredentialAdapter(candidates)
}
