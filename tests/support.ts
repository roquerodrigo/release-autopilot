import type {
  NotesAuthor,
  ReleasePlanner,
  ReleasePublisher,
  ReleasePullRequest,
  ReleasePullRequestDraft,
  Reporter,
  RepositoryReader,
} from '../src/application/ports.ts'
import type { WrittenNotes } from '../src/domain/release-notes.ts'
import type { CommitSummary, ReleasePlan } from '../src/domain/release-plan.ts'
import type { CommitDetails } from '../src/domain/release-source.ts'

import { isReleaseTag } from '../src/domain/release-plan.ts'

export class FixedAuthor implements NotesAuthor {
  calls = 0
  readonly notes: Error | WrittenNotes

  constructor(notes: Error | WrittenNotes) {
    this.notes = notes
  }

  async write(): Promise<WrittenNotes> {
    this.calls += 1
    if (this.notes instanceof Error) {
      throw this.notes
    }
    return this.notes
  }
}

export class FixedPlanner implements ReleasePlanner {
  readonly plan_: ReleasePlan | undefined
  requests: Parameters<ReleasePlanner['plan']>[0][] = []

  constructor(plan: ReleasePlan | undefined) {
    this.plan_ = plan
  }

  async plan(request: Parameters<ReleasePlanner['plan']>[0]): Promise<ReleasePlan | undefined> {
    this.requests.push(request)
    return this.plan_
  }
}

export class InMemoryReader implements RepositoryReader {
  readonly commits = new Map<string, CommitDetails>()
  compared: CommitSummary[] = []
  readonly files = new Map<string, string>()
  readonly repository = 'owner/project'
  readonly tags = new Set<string>()

  async commitDetails(sha: string): Promise<CommitDetails> {
    return this.commits.get(sha) ?? {
      authorLogin: 'someone',
      files: [],
      message: `feat: ${sha}`,
      pullRequest: undefined,
    }
  }

  async commitsBetween(): Promise<CommitSummary[]> {
    return this.compared
  }

  async defaultBranch(): Promise<string> {
    return 'main'
  }

  async fileAt(path: string): Promise<string | undefined> {
    return this.files.get(path)
  }

  async firstParentOf(): Promise<string> {
    return 'parent'
  }

  async hasReleaseTag(): Promise<boolean> {
    return [...this.tags].some(isReleaseTag)
  }

  async headOf(): Promise<string> {
    return 'head'
  }

  async pathsAt(): Promise<string[]> {
    return [...this.files.keys()]
  }

  async tagExists(tag: string): Promise<boolean> {
    return this.tags.has(tag)
  }
}

export class RecordingPublisher implements ReleasePublisher {
  closed: ReleasePullRequest[] = []
  merged: ReleasePullRequest | undefined
  open: ReleasePullRequest | undefined
  releases: { body: string, tag: string, targetSha: string }[] = []
  written: ReleasePullRequestDraft[] = []

  async closePullRequest(pullRequest: ReleasePullRequest): Promise<void> {
    this.closed.push(pullRequest)
  }

  async createRelease(release: { body: string, tag: string, targetSha: string }): Promise<boolean> {
    this.releases.push(release)
    return true
  }

  async findLatestMergedPullRequest(): Promise<ReleasePullRequest | undefined> {
    return this.merged
  }

  async findOpenPullRequest(): Promise<ReleasePullRequest | undefined> {
    return this.open
  }

  async writePullRequest(draft: ReleasePullRequestDraft, open: ReleasePullRequest | undefined): Promise<ReleasePullRequest> {
    this.written.push(draft)
    return open ?? { body: draft.body, mergeCommitSha: null, number: 7, url: 'https://example.test/pull/7' }
  }
}

export class RecordingReporter implements Reporter {
  infos: string[] = []
  warnings: string[] = []

  info(message: string): void {
    this.infos.push(message)
  }

  warning(message: string): void {
    this.warnings.push(message)
  }
}

export function writtenEntry(category: string, text: string, pullRequests: number[] = []) {
  return { category, pull_requests: pullRequests, text: { 'en': text, 'pt-BR': text } }
}

export function writtenNotes(...entries: ReturnType<typeof writtenEntry>[]): WrittenNotes {
  return { entries, summary: { 'en': '', 'pt-BR': '' } }
}
