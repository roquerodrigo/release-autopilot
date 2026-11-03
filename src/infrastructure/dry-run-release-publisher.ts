import type { ReleasePublisher, ReleasePullRequest, ReleasePullRequestDraft, Reporter } from '../application/ports.ts'

export class DryRunReleasePublisher implements ReleasePublisher {
  private readonly actual: ReleasePublisher
  private readonly reporter: Reporter

  constructor(actual: ReleasePublisher, reporter: Reporter) {
    this.actual = actual
    this.reporter = reporter
  }

  async closePullRequest(pullRequest: ReleasePullRequest): Promise<void> {
    this.reporter.info(`Dry run: would close ${pullRequest.url}`)
  }

  async createRelease({ body, tag, targetSha }: { body: string, tag: string, targetSha: string }): Promise<boolean> {
    this.reporter.info(`Dry run: would publish ${tag} at ${targetSha}\n\n${body}`)
    return false
  }

  findLatestMergedPullRequest(branch: string): Promise<ReleasePullRequest | undefined> {
    return this.actual.findLatestMergedPullRequest(branch)
  }

  findOpenPullRequest(branch: string): Promise<ReleasePullRequest | undefined> {
    return this.actual.findOpenPullRequest(branch)
  }

  async writePullRequest(draft: ReleasePullRequestDraft, open: ReleasePullRequest | undefined): Promise<ReleasePullRequest> {
    const paths = draft.changes.map((change) => change.path).join(', ')
    this.reporter.info(`Dry run: would write "${draft.title}" changing ${paths}\n\n${draft.body}`)
    return open ?? { body: draft.body, mergeCommitSha: null, number: 0, url: '' }
  }
}
