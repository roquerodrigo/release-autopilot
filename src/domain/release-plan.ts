import { createHash } from 'node:crypto'

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/

export interface CommitSummary {
  message: string
  sha: string
}

export interface FileChange {
  content: string
  path: string
}

export interface PlannedCommit {
  isBreaking: boolean
  sha: string
}

export interface ReleasePlan {
  commits: readonly PlannedCommit[]
  fileChanges: readonly FileChange[]
  previousTag: string | undefined
  version: string
}

export function isReleaseTag(name: string): boolean {
  return RELEASE_TAG.test(name)
}

export function notesFingerprint(material: {
  commitShas: readonly string[]
  configuration: string | undefined
  hacsManifest: string | undefined
  version: string
}): string {
  const lines = [material.configuration ?? '', material.hacsManifest ?? '', material.version, ...material.commitShas]
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

export function pullRequestTitleOf(branch: string, version: string): string {
  return `chore(${branch}): release ${version}`
}

export function releaseHeading(repository: string, plan: Pick<ReleasePlan, 'previousTag' | 'version'>, today: Date): string {
  const date = today.toISOString().slice(0, 10)
  if (!plan.previousTag) {
    return `## ${plan.version} (${date})`
  }
  const comparison = `https://github.com/${repository}/compare/${plan.previousTag}...${tagOf(plan.version)}`
  return `## [${plan.version}](${comparison}) (${date})`
}

export function tagOf(version: string): string {
  return `v${version}`
}
