import type { ReleasePullRequest, Reporter } from './ports.ts'
import type { PrepareReleasePullRequest } from './prepare-release-pull-request.ts'
import type { PublishedRelease, PublishMergedRelease } from './publish-merged-release.ts'

export interface ReleaseOutcome {
  published: PublishedRelease | undefined
  pullRequest: ReleasePullRequest | undefined
}

export async function runRelease(
  branch: string,
  publishMerged: PublishMergedRelease,
  prepare: PrepareReleasePullRequest,
  reporter: Reporter,
): Promise<ReleaseOutcome> {
  const published = await publishMerged.run(branch)
  try {
    return { published, pullRequest: await prepare.run(branch) }
  } catch (error) {
    if (!published) {
      throw error
    }
    reporter.warning(`The next release pull request waits for the next run: ${String(error)}`)
    return { published, pullRequest: undefined }
  }
}
