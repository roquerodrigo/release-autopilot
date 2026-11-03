import type { ProjectConfiguration } from '../domain/project-configuration.ts'
import type { WrittenNotes } from '../domain/release-notes.ts'
import type { CommitSummary, FileChange, ReleasePlan } from '../domain/release-plan.ts'
import type { CommitDetails, ReleaseSource } from '../domain/release-source.ts'
import type { StructuredVersionFile } from '../domain/version-file.ts'

export interface NotesAuthor {
  write(source: ReleaseSource, configuration: ProjectConfiguration): Promise<WrittenNotes>
}

export interface ReleasePlanner {
  plan(request: ReleasePlanRequest): Promise<ReleasePlan | undefined>
}

export interface ReleasePlanRequest {
  branch: string
  initialVersion: string | undefined
  versionFiles: readonly StructuredVersionFile[]
}

export interface ReleasePublisher {
  closePullRequest(pullRequest: ReleasePullRequest, branch: string): Promise<void>
  createRelease(release: { body: string, tag: string, targetSha: string }): Promise<boolean>
  findLatestMergedPullRequest(branch: string): Promise<ReleasePullRequest | undefined>
  findOpenPullRequest(branch: string): Promise<ReleasePullRequest | undefined>
  writePullRequest(draft: ReleasePullRequestDraft, open: ReleasePullRequest | undefined): Promise<ReleasePullRequest>
}

export interface ReleasePullRequest {
  body: null | string
  mergeCommitSha: null | string
  number: number
  url: string
}

export interface ReleasePullRequestDraft {
  base: string
  body: string
  changes: readonly FileChange[]
  head: string
  headParentSha: string
  title: string
}

export interface Reporter {
  info(message: string): void
  warning(message: string): void
}

export interface RepositoryReader {
  commitDetails(sha: string): Promise<CommitDetails>
  commitsBetween(base: string, head: string): Promise<CommitSummary[]>
  defaultBranch(): Promise<string>
  fileAt(path: string, ref: string): Promise<string | undefined>
  firstParentOf(ref: string): Promise<string>
  hasReleaseTag(): Promise<boolean>
  headOf(branch: string): Promise<string>
  pathsAt(ref: string): Promise<string[]>
  readonly repository: string
  tagExists(tag: string): Promise<boolean>
}

export function releaseBranchOf(targetBranch: string): string {
  return `release/${targetBranch}`
}
