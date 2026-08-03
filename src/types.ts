export type AuthMode = 'auto' | 'onebot' | 'onebot-http' | 'manual'

export interface CredentialResult {
  cookie: string
  source: string
  nickname?: string
}

export interface CredentialAdapter {
  readonly name: string
  getCredential(): Promise<CredentialResult>
}

export interface QzoneCredentials {
  uin: string
  skey: string
  pSkey: string
  cookie: string
  source: string
  nickname?: string
}

export interface Comment {
  tid: string
  uin: string
  nickname: string
  content: string
  createTime: number
  parentTid?: string
}

export type PostStatus = 'approved' | 'pending' | 'rejected'

export interface Post {
  id?: number
  tid: string
  uin: string
  name: string
  avatarUrl: string
  groupId: string
  submitterId: string
  text: string
  images: string[]
  videos: string[]
  anonymous: boolean
  status: PostStatus
  createTime: number
  repostContent: string
  comments: Comment[]
  extraText: string
}

export interface ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean
  code: number
  message?: string
  data: T
  raw: Record<string, unknown>
  httpStatus?: number
}

export interface FeedQuery {
  targetId?: string
  offset?: number
  limit?: number
  withDetail?: boolean
  excludeSelf?: boolean
  excludeCommented?: boolean
}

export interface RangeSelection {
  offset: number
  limit: number
}

export function createEmptyPost(patch: Partial<Post> = {}): Post {
  return {
    tid: '',
    uin: '0',
    name: '',
    avatarUrl: '',
    groupId: '',
    submitterId: '',
    text: '',
    images: [],
    videos: [],
    anonymous: false,
    status: 'approved',
    createTime: 0,
    repostContent: '',
    comments: [],
    extraText: '',
    ...patch,
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
