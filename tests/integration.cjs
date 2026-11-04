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
    onebotSelfId: '123456789',
    debugLogging: false,
    ...patch,
  }
}

async function main() {
  assert.deepEqual(plugin.inject.required, ['chatluna'])
  assert.deepEqual(plugin.inject.optional, ['database'])
  assert.equal(plugin.Config.type, 'object')
  assert.deepEqual(
    Object.keys(plugin.Config.dict),
    ['onebotSelfId', 'debugLogging', 'imageHosts'],
  )
  assert.throws(() => plugin.Config({}))
  assert.throws(() => plugin.Config({ onebotSelfId: 'not-a-qq-number' }))
  assert.equal(plugin.Config({ onebotSelfId: '123456789' }).debugLogging, false)
  assert.deepEqual(plugin.Config({ onebotSelfId: '123456789' }).imageHosts, [
    '*.qpic.cn',
    '*.qlogo.cn',
    '*.qq.com',
    '*.gtimg.cn',
  ])
  assert.deepEqual(
    plugin.Config({
      onebotSelfId: '123456789',
      imageHosts: ['s3.lumia.wang', '*.example.com'],
    }).imageHosts,
    ['s3.lumia.wang', '*.example.com'],
  )
  assert.throws(() => plugin.Config({
    onebotSelfId: '123456789',
    imageHosts: ['192.168.1.1'],
  }))
  assert.throws(() => plugin.Config({
    onebotSelfId: '123456789',
    imageHosts: ['http://example.com'],
  }))
  assert.equal(plugin.Config(makeConfig()).onebotSelfId, '123456789')

  const withoutDatabase = new Context()
  assert.doesNotThrow(() => plugin.apply(withoutDatabase, makeConfig()))
  assert.ok(withoutDatabase.$commander.resolve('qzone.status'))
  assert.ok(withoutDatabase.$commander.resolve('qzone.feed'))
  assert.ok(withoutDatabase.$commander.resolve('qzone.unlike'))
  assert.ok(withoutDatabase.$commander.resolve('qzone.comment'))
  assert.ok(withoutDatabase.$commander.resolve('qzone.publish'))
  assert.equal(withoutDatabase.$commander.resolve('qzone.login'), undefined)
  assert.equal(withoutDatabase.$commander.resolve('qzone.logout'), undefined)
  assert.equal(withoutDatabase.$commander.resolve('qzone.visitors'), undefined)
  assert.equal(withoutDatabase.$commander.resolve('qzone.refresh'), undefined)

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
