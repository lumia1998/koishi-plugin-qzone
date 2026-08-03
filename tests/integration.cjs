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
    commandAuthority: 1,
    adminAuthority: 3,
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
