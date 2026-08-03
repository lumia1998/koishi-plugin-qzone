const assert = require('node:assert/strict')

const MemoryDriver = require('@koishijs/plugin-database-memory').default
const { Context } = require('koishi')

const plugin = require('../lib')
const {
  createRepository,
  defineDatabaseModel,
  KoishiPostRepository,
} = require('../lib/repository')
const { createEmptyPost } = require('../lib/types')

function makeConfig(patch = {}) {
  return {
    authMode: 'auto',
    botId: '',
    manualCookie: '',
    onebotHttpUrl: '',
    onebotAccessToken: '',
    allowInsecureOnebotHttp: false,
    qrCredentialPath: 'data/qzone/test-credentials.json',
    qrLoginTimeoutSeconds: 120,
    qrPollIntervalMs: 2000,
    cookieTtlSeconds: 600,
    timeoutMs: 10000,
    defaultFeedCount: 5,
    maxImageBytes: 8 * 1024 * 1024,
    maxImages: 9,
    allowedImageHosts: ['*.qpic.cn'],
    commandAuthority: 1,
    adminAuthority: 3,
    autoCommentCron: '',
    autoCommentText: '',
    autoLikeWithComment: true,
    autoPublishCron: '',
    autoPublishText: '',
    cronTimezone: 'Asia/Shanghai',
    randomOffsetSeconds: 0,
    ...patch,
  }
}

async function main() {
  assert.deepEqual(plugin.inject.required, ['chatluna'])
  assert.deepEqual(plugin.inject.optional, ['database'])
  const withoutDatabase = new Context()
  assert.doesNotThrow(() => plugin.apply(withoutDatabase, makeConfig()))
  assert.ok(withoutDatabase.$commander.resolve('qzone.login'))
  assert.ok(withoutDatabase.$commander.resolve('qzone.logout'))

  const invalidCron = new Context()
  assert.doesNotThrow(() => plugin.apply(invalidCron, makeConfig({
    autoCommentCron: 'invalid cron',
    autoCommentText: 'test',
  })))

  const ctx = new Context()
  ctx.plugin(MemoryDriver)
  defineDatabaseModel(ctx)
  await ctx.start()
  try {
    const repository = createRepository(ctx)
    assert.ok(repository instanceof KoishiPostRepository)
    const created = await repository.save(createEmptyPost({
      uin: '10001',
      tid: 'remote-tid',
      name: 'Alice',
      text: 'first',
    }))
    assert.equal(typeof created.id, 'number')

    const updated = await repository.save(createEmptyPost({
      uin: '10001',
      tid: 'remote-tid',
      name: 'Alice',
      text: 'updated',
    }))
    assert.equal(updated.id, created.id)
    assert.equal((await repository.getByRemote('10001', 'remote-tid')).text, 'updated')
    assert.equal((await repository.list('approved')).length, 1)
    assert.equal(await repository.remove(created.id), true)
    assert.equal(await repository.getById(created.id), undefined)
  } finally {
    await ctx.stop()
  }

  console.log('integration: OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
