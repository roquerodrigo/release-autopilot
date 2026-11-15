import type { ProjectConfiguration } from '../domain/project-configuration.ts'
import type { LocalizedNotes, WrittenNotes } from '../domain/release-notes.ts'
import type { ReleaseSource } from '../domain/release-source.ts'
import type { NotesAuthor, Reporter } from './ports.ts'

import { RejectedNotesError } from '../domain/errors.ts'
import { composedNotes } from '../domain/release-notes.ts'

const MAXIMUM_ATTEMPTS = 3

export interface AcceptedNotes {
  notes: LocalizedNotes[]
  written: WrittenNotes
}

export async function acceptedNotesOf(
  author: NotesAuthor,
  source: ReleaseSource,
  configuration: ProjectConfiguration,
  reporter: Reporter,
): Promise<AcceptedNotes> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const written = await author.write(source, configuration)
      return { notes: composedNotes(written, source, configuration), written }
    } catch (error) {
      if (!(error instanceof RejectedNotesError) || attempt === MAXIMUM_ATTEMPTS) {
        throw error
      }
      reporter.warning(`The notes were rejected, ${error.message}, so the model writes them again (attempt ${attempt + 1} of ${MAXIMUM_ATTEMPTS})`)
    }
  }
}
