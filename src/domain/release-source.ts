import type { ProjectConfiguration } from './project-configuration.ts'

const MAXIMUM_DESCRIPTION_CHARACTERS = 6_000
const MAXIMUM_PATCH_CHARACTERS_PER_COMMIT = 20_000
const MAXIMUM_PATCH_CHARACTERS_PER_FILE = 4_000
const GENERATED_FILES = ['CHANGELOG.md', 'package-lock.json', 'uv.lock']

export interface CommitDetails {
  authorLogin: string | undefined
  files: readonly CommitFile[]
  message: string
  pullRequest: undefined | {
    body: null | string
    number: number
    title: string
  }
}

export interface CommitFile {
  additions: number
  deletions: number
  patch: string
  path: string
}

export interface ReleaseCommit {
  files: CommitFile[]
  is_breaking: boolean
  message: string
  pull_request_description: string
  pull_request_number: null | number
  pull_request_title: string
}

export interface ReleaseSource {
  commits: readonly ReleaseCommit[]
  repository: string
}

export function hasBreakingCommit(source: ReleaseSource): boolean {
  return source.commits.some((commit) => commit.is_breaking)
}

export function knownPullRequests(source: ReleaseSource): Set<number> {
  return new Set(source.commits.flatMap((commit) => commit.pull_request_number ?? []))
}

export function releaseCommitOf(
  details: CommitDetails,
  isBreaking: boolean,
  configuration: ProjectConfiguration,
): ReleaseCommit {
  const writtenByBot = isBot(details.authorLogin)
  return {
    files: boundedFiles(details.files, writtenByBot, configuration),
    is_breaking: isBreaking,
    message: details.message,
    pull_request_description: writtenByBot ?
      '' :
        (details.pullRequest?.body ?? '').slice(0, MAXIMUM_DESCRIPTION_CHARACTERS),
    pull_request_number: details.pullRequest?.number ?? null,
    pull_request_title: details.pullRequest?.title ?? '',
  }
}

function boundedFiles(
  files: readonly CommitFile[],
  writtenByBot: boolean,
  configuration: ProjectConfiguration,
): CommitFile[] {
  let remaining = writtenByBot ? 0 : MAXIMUM_PATCH_CHARACTERS_PER_COMMIT
  const priorityFirst = [...files].sort((first, second) =>
    Number(configuration.isPriority(second.path)) - Number(configuration.isPriority(first.path)))
  return priorityFirst.map((file) => {
    const isGenerated = GENERATED_FILES.some((generated) => file.path.endsWith(generated))
    let patch = isGenerated ? '' : file.patch
    if (!configuration.isPriority(file.path)) {
      patch = patch.slice(0, Math.min(MAXIMUM_PATCH_CHARACTERS_PER_FILE, remaining))
      remaining -= patch.length
    } else if (writtenByBot) {
      patch = ''
    }
    return { ...file, patch }
  })
}

function isBot(login: string | undefined): boolean {
  return login === undefined || login.endsWith('[bot]')
}
