import type { NotesAuthor, RepositoryReader } from './ports.ts'

import { isBreakingCommit } from '../domain/conventional-commit.ts'
import { composedNotes } from '../domain/release-notes.ts'
import { projectSnapshotAt } from './project-snapshot.ts'
import { collectReleaseSource } from './release-source-collector.ts'

export class PreviewPastRelease {
  private readonly author: NotesAuthor
  private readonly reader: RepositoryReader

  constructor(reader: RepositoryReader, author: NotesAuthor) {
    this.reader = reader
    this.author = author
  }

  async run(previousTag: string, releaseTag: string): Promise<string> {
    const releasedSha = await this.reader.firstParentOf(releaseTag)
    const { configuration } = await projectSnapshotAt(this.reader, releasedSha)
    const commits = await this.reader.commitsBetween(previousTag, releasedSha)
    const planned = commits.map(({ message, sha }) => ({ isBreaking: isBreakingCommit(message), sha }))
    const source = await collectReleaseSource(this.reader, planned, configuration)
    const written = await this.author.write(source, configuration)
    const notes = composedNotes(written, source, configuration)
    if (written.entries.length === 0) {
      return `# ${this.reader.repository}\n\nNothing relevant, so no release would open.\n`
    }
    return notes
      .map(({ changelog, text }) => `# ${this.reader.repository} (${changelog.language})\n\n${text}`)
      .join('\n')
  }
}
