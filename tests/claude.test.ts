import Anthropic from '@anthropic-ai/sdk'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RejectedNotesError } from '../src/domain/errors.ts'
import { ProjectConfiguration } from '../src/domain/project-configuration.ts'
import { ClaudeNotesAuthor } from '../src/infrastructure/claude-notes-author.ts'
import { claudeAnswer } from './fake-claude.ts'

const SOURCE = { commits: [], repository: 'owner/project' }
const NOTES = { entries: [], summary: { en: '' } }

function authorAnswering(text: string | undefined, stopReason = 'end_turn') {
  const requests: Record<string, unknown>[] = []
  const client = new Anthropic({
    apiKey: 'key',
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return claudeAnswer(text, stopReason)
    },
    maxRetries: 0,
  })
  return { author: new ClaudeNotesAuthor(client), requests }
}

describe('ClaudeNotesAuthor', () => {
  it('asks the configured model at the configured effort, with no tools', async () => {
    const { author, requests } = authorAnswering(JSON.stringify(NOTES))
    const configuration = ProjectConfiguration.parse('model: claude-opus-5-5\neffort: high\n', 'en')
    assert.deepEqual(await author.write(SOURCE, configuration), NOTES)
    assert.equal(requests[0].model, 'claude-opus-5-5')
    assert.equal((requests[0].output_config as { effort: string }).effort, 'high')
    assert.equal(requests[0].tools, undefined)
  })

  it('falls back to the default model and effort', async () => {
    const { author, requests } = authorAnswering(JSON.stringify(NOTES))
    await author.write(SOURCE, ProjectConfiguration.parse(undefined, 'en'))
    assert.equal(requests[0].model, 'claude-haiku-5-5')
    assert.equal((requests[0].output_config as { effort: string }).effort, 'medium')
  })

  it('rejects notes the model did not finish', async () => {
    const { author } = authorAnswering('{"entries"', 'max_tokens')
    await assert.rejects(author.write(SOURCE, ProjectConfiguration.parse(undefined, 'en')), RejectedNotesError)
  })

  it('rejects an answer with no text', async () => {
    const { author } = authorAnswering(undefined)
    await assert.rejects(author.write(SOURCE, ProjectConfiguration.parse(undefined, 'en')), RejectedNotesError)
  })
})
