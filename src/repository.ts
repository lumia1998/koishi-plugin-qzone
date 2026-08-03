import type { Context } from 'koishi'

import type { Post, PostStatus } from './types'

export interface QzonePostRecord {
  id: number
  key: string
  tid: string
  uin: string
  status: PostStatus
  submitterId: string
  groupId: string
  payload: Post
  createdAt: Date
  updatedAt: Date
}

declare module 'koishi' {
  interface Tables {
    qzone_post: QzonePostRecord
  }
}

export interface PostRepository {
  save(post: Post): Promise<Post>
  getById(id: number): Promise<Post | undefined>
  getByRemote(uin: string, tid: string): Promise<Post | undefined>
  list(status?: PostStatus, limit?: number): Promise<Post[]>
  remove(id: number): Promise<boolean>
}

function remoteKey(post: Pick<Post, 'uin' | 'tid'>): string {
  return `remote:${post.uin}:${post.tid}`
}

function clonePost(post: Post): Post {
  return structuredClone(post)
}

export class MemoryPostRepository implements PostRepository {
  private readonly posts = new Map<number, Post>()
  private nextId = 1

  async save(post: Post): Promise<Post> {
    let existingId = post.id
    if (!existingId && post.tid) {
      existingId = [...this.posts.entries()]
        .find(([, item]) => item.uin === post.uin && item.tid === post.tid)?.[0]
    }
    const id = existingId || this.nextId++
    const saved = clonePost({ ...post, id })
    this.posts.set(id, saved)
    Object.assign(post, saved)
    return clonePost(saved)
  }

  async getById(id: number): Promise<Post | undefined> {
    const post = this.posts.get(id)
    return post ? clonePost(post) : undefined
  }

  async getByRemote(uin: string, tid: string): Promise<Post | undefined> {
    const post = [...this.posts.values()].find((item) => item.uin === uin && item.tid === tid)
    return post ? clonePost(post) : undefined
  }

  async list(status?: PostStatus, limit = 20): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => !status || post.status === status)
      .sort((left, right) => (right.id || 0) - (left.id || 0))
      .slice(0, limit)
      .map(clonePost)
  }

  async remove(id: number): Promise<boolean> {
    return this.posts.delete(id)
  }
}

export class KoishiPostRepository implements PostRepository {
  constructor(private readonly ctx: Context) {}

  async save(post: Post): Promise<Post> {
    let record: QzonePostRecord | undefined
    if (post.id) {
      record = (await this.ctx.database.get('qzone_post', { id: post.id }, { limit: 1 }))[0]
    }
    if (!record && post.tid) {
      record = (await this.ctx.database.get('qzone_post', { key: remoteKey(post) }, { limit: 1 }))[0]
    }

    const now = new Date()
    if (record) {
      const payload = clonePost({ ...post, id: record.id })
      await this.ctx.database.set('qzone_post', { id: record.id }, {
        key: post.tid ? remoteKey(post) : record.key,
        tid: post.tid,
        uin: post.uin,
        status: post.status,
        submitterId: post.submitterId,
        groupId: post.groupId,
        payload,
        updatedAt: now,
      })
      Object.assign(post, payload)
      return payload
    }

    const key = post.tid
      ? remoteKey(post)
      : `draft:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
    const created = await this.ctx.database.create('qzone_post', {
      key,
      tid: post.tid,
      uin: post.uin,
      status: post.status,
      submitterId: post.submitterId,
      groupId: post.groupId,
      payload: clonePost(post),
      createdAt: now,
      updatedAt: now,
    })
    const payload = clonePost({ ...post, id: created.id })
    await this.ctx.database.set('qzone_post', { id: created.id }, { payload })
    Object.assign(post, payload)
    return payload
  }

  async getById(id: number): Promise<Post | undefined> {
    const record = (await this.ctx.database.get('qzone_post', { id }, { limit: 1 }))[0]
    return record ? clonePost({ ...record.payload, id: record.id }) : undefined
  }

  async getByRemote(uin: string, tid: string): Promise<Post | undefined> {
    const record = (await this.ctx.database.get('qzone_post', { key: remoteKey({ uin, tid }) }, { limit: 1 }))[0]
    return record ? clonePost({ ...record.payload, id: record.id }) : undefined
  }

  async list(status?: PostStatus, limit = 20): Promise<Post[]> {
    const query = status ? { status } : {}
    const records = await this.ctx.database.get('qzone_post', query, {
      limit,
      sort: { id: 'desc' },
    })
    return records.map((record) => clonePost({ ...record.payload, id: record.id }))
  }

  async remove(id: number): Promise<boolean> {
    const removed = await this.ctx.database.remove('qzone_post', { id })
    return (removed.matched || 0) > 0
  }
}

export function defineDatabaseModel(ctx: Context): void {
  ctx.model.extend('qzone_post', {
    id: { type: 'unsigned' },
    key: { type: 'string', length: 255 },
    tid: { type: 'string', length: 128 },
    uin: { type: 'string', length: 64 },
    status: { type: 'string', length: 16 },
    submitterId: { type: 'string', length: 64 },
    groupId: { type: 'string', length: 128 },
    payload: { type: 'json' },
    createdAt: { type: 'timestamp' },
    updatedAt: { type: 'timestamp' },
  }, {
    autoInc: true,
    primary: 'id',
    unique: ['key'],
  })
}

export function createRepository(ctx: Context): PostRepository {
  try {
    if (ctx.database) return new KoishiPostRepository(ctx)
  } catch {
    // The database service is optional.
  }
  return new MemoryPostRepository()
}
