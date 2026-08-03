import { DynamicStructuredTool } from '@langchain/core/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('LangChain security overrides', () => {
  it('keeps the ChatLuna tool and LangSmith integration paths compatible', async () => {
    const tool = new DynamicStructuredTool({
      name: 'dependency_smoke_test',
      description: 'Verify the overridden LangChain dependency graph.',
      schema: z.object({ value: z.string() }),
      async func({ value }) {
        return value
      },
    })

    await expect(tool.invoke({ value: 'ok' })).resolves.toBe('ok')

    const [runnables, tracer, loader] = await Promise.all([
      import('@langchain/core/runnables'),
      import('@langchain/core/tracers/tracer_langchain'),
      import('@langchain/core/document_loaders/langsmith'),
    ])
    expect(runnables.RunnableSequence).toBeTypeOf('function')
    expect(tracer.LangChainTracer).toBeTypeOf('function')
    expect(loader.LangSmithLoader).toBeTypeOf('function')
  })
})
