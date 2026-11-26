import type { NotesAuthor, Reporter, RepositoryReader } from './ports.ts'

import { isBreakingCommit } from '../domain/conventional-commit.ts'
import { acceptedNotesOf } from './accepted-notes.ts'
import { projectSnapshotAt } from './project-snapshot.ts'
import { collectReleaseSource } from './release-source-collector.ts'

export class PreviewPastRelease {
  private readonly author: NotesAuthor
  private readonly reader: RepositoryReader
  private readonly reporter: Reporter

  constructor(reader: RepositoryReader, author: NotesAuthor, reporter: Reporter) {
    this.reader = reader
    this.author = author
    this.reporter = reporter
  }

  async run(previousTag: string, releaseTag: string): Promise<string> {
    const releasedSha = await this.reader.firstParentOf(releaseTag)
    const { configuration } = await projectSnapshotAt(this.reader, releasedSha)
    const commits = await this.reader.commitsBetween(previousTag, releasedSha)
    const planned = commits.map(({ message, sha }) => ({ isBreaking: isBreakingCommit(message), sha }))
    const source = await collectReleaseSource(this.reader, planned, configuration)
    const { notes, written } = await acceptedNotesOf(this.author, source, configuration, this.reporter, { forced: false })
    if (written.entries.length === 0) {
      return `# ${this.reader.repository}\n\nNothing relevant, so no release would open.\n`
    }
    return notes
      .map(({ changelog, text }) => `# ${this.reader.repository} (${changelog.language})\n\n${text}`)
      .join('\n')
  }
}
