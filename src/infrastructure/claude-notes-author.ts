import Anthropic from '@anthropic-ai/sdk'

import type { NotesAuthor } from '../application/ports.ts'
import type { ProjectConfiguration } from '../domain/project-configuration.ts'
import type { WrittenNotes } from '../domain/release-notes.ts'
import type { ReleaseSource } from '../domain/release-source.ts'

import { RejectedNotesError } from '../domain/errors.ts'
import { outputSchema, systemPrompt, userMessage } from './notes-prompt.ts'

const MAXIMUM_OUTPUT_TOKENS = 64_000

export class ClaudeNotesAuthor implements NotesAuthor {
  private readonly client: Anthropic

  constructor(client: Anthropic) {
    this.client = client
  }

  async write(source: ReleaseSource, configuration: ProjectConfiguration): Promise<WrittenNotes> {
    const response = await this.client.messages.stream({
      max_tokens: MAXIMUM_OUTPUT_TOKENS,
      messages: [{ content: userMessage(source, configuration), role: 'user' }],
      model: configuration.model,
      output_config: {
        effort: configuration.effort,
        format: { schema: outputSchema(configuration), type: 'json_schema' },
      },
      system: systemPrompt(configuration),
    }).finalMessage()
    if (response.stop_reason !== 'end_turn') {
      throw new RejectedNotesError(`the model stopped with ${response.stop_reason}`)
    }
    const text = response.content.find((block) => block.type === 'text')
    if (!text) {
      throw new RejectedNotesError('the model returned no text')
    }
    return JSON.parse(text.text) as WrittenNotes
  }
}
