import type { ProjectConfiguration } from '../domain/project-configuration.ts'
import type { PlannedCommit } from '../domain/release-plan.ts'
import type { ReleaseCommit, ReleaseSource } from '../domain/release-source.ts'
import type { RepositoryReader } from './ports.ts'

import { releaseCommitOf } from '../domain/release-source.ts'

export async function collectReleaseSource(
  reader: RepositoryReader,
  commits: readonly PlannedCommit[],
  configuration: ProjectConfiguration,
): Promise<ReleaseSource> {
  const releaseCommits: ReleaseCommit[] = []
  for (const commit of commits) {
    const details = await reader.commitDetails(commit.sha)
    releaseCommits.push(releaseCommitOf(details, commit.isBreaking, configuration))
  }
  return { commits: releaseCommits, repository: reader.repository }
}
