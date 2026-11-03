import type { ReleasePublisher, Reporter, RepositoryReader } from './ports.ts'

import { notesOfPullRequest, stateOfPullRequest } from '../domain/release-documents.ts'
import { tagOf } from '../domain/release-plan.ts'

export interface PublishedRelease {
  tag: string
  version: string
}

export class PublishMergedRelease {
  private readonly publisher: ReleasePublisher
  private readonly reader: RepositoryReader
  private readonly reporter: Reporter

  constructor(reader: RepositoryReader, publisher: ReleasePublisher, reporter: Reporter) {
    this.reader = reader
    this.publisher = publisher
    this.reporter = reporter
  }

  async run(branch: string): Promise<PublishedRelease | undefined> {
    const merged = await this.publisher.findLatestMergedPullRequest(branch)
    if (!merged?.body || !merged.mergeCommitSha) {
      return undefined
    }
    const state = stateOfPullRequest(merged.body)
    if (!state) {
      this.reporter.warning(`${merged.url} no longer records its release, so nothing was published from it`)
      return undefined
    }
    const tag = tagOf(state.version)
    if (await this.reader.tagExists(tag)) {
      return undefined
    }
    const created = await this.publisher.createRelease({
      body: notesOfPullRequest(merged.body),
      tag,
      targetSha: merged.mergeCommitSha,
    })
    if (!created) {
      return undefined
    }
    this.reporter.info(`Published ${tag}`)
    return { tag, version: state.version }
  }
}
