export const DEFAULT_QZONE_SETTINGS = {
  credentialPath: 'data/qzone/credentials.json',
  qrLoginTimeoutSeconds: 120,
  qrPollIntervalMs: 2000,
  cookieTtlSeconds: 600,
  timeoutMs: 10_000,
  defaultFeedCount: 5,
  maxImageBytes: 8 * 1024 * 1024,
  maxImages: 9,
  allowedImageHosts: [
    '*.qpic.cn',
    '*.qlogo.cn',
    '*.qq.com',
    '*.gtimg.cn',
  ],
} as const
