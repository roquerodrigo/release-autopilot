import type { Octokit } from '@octokit/rest'

import type { ReleasePublisher, ReleasePullRequest, ReleasePullRequestDraft, Reporter } from '../application/ports.ts'

import { releaseBranchOf } from '../application/ports.ts'

interface GitHubPullRequest {
  body: null | string
  html_url: string
  merge_commit_sha: null | string
  merged_at: null | string
  number: number
}

export class GitHubReleasePublisher implements ReleasePublisher {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string
  private readonly reporter: Reporter

  constructor(octokit: Octokit, repository: string, reporter: Reporter) {
    this.octokit = octokit
    this.reporter = reporter
    const [owner, repo] = repository.split('/')
    this.owner = owner
    this.repo = repo
  }

  async closePullRequest(pullRequest: ReleasePullRequest, branch: string): Promise<void> {
    await this.octokit.pulls.update({ ...this.target(), pull_number: pullRequest.number, state: 'closed' })
    await this.octokit.git.deleteRef({ ...this.target(), ref: `heads/${releaseBranchOf(branch)}` })
    this.reporter.info(`Closed ${pullRequest.url}, since there is nothing left to release`)
  }

  async createRelease({ body, tag, targetSha }: { body: string, tag: string, targetSha: string }): Promise<boolean> {
    await this.octokit.repos.createRelease({
      ...this.target(),
      body,
      name: tag,
      tag_name: tag,
      target_commitish: targetSha,
    })
    return true
  }

  async findLatestMergedPullRequest(branch: string): Promise<ReleasePullRequest | undefined> {
    const pullRequests = await this.pullRequestsFrom(branch, 'closed')
    const merged = pullRequests
      .filter((pullRequest) => pullRequest.merged_at)
      .sort((first, second) => second.merged_at!.localeCompare(first.merged_at!))
    return merged[0] && toReleasePullRequest(merged[0])
  }

  async findOpenPullRequest(branch: string): Promise<ReleasePullRequest | undefined> {
    const [open] = await this.pullRequestsFrom(branch, 'open')
    return open && toReleasePullRequest(open)
  }

  async writePullRequest(draft: ReleasePullRequestDraft, open: ReleasePullRequest | undefined): Promise<ReleasePullRequest> {
    await this.pointBranchAt(draft.head, await this.commitOf(draft), open !== undefined)
    const { data } = open ?
        await this.octokit.pulls.update({
          ...this.target(),
          body: draft.body,
          pull_number: open.number,
          title: draft.title,
        }) :
        await this.octokit.pulls.create({
          ...this.target(),
          base: draft.base,
          body: draft.body,
          head: draft.head,
          title: draft.title,
        })
    const pullRequest = toReleasePullRequest(data)
    const paths = draft.changes.map((change) => change.path).join(', ')
    this.reporter.info(`${open ? 'Updated' : 'Opened'} ${pullRequest.url}, "${draft.title}", changing ${paths}`)
    return pullRequest
  }

  private async commitOf(draft: ReleasePullRequestDraft): Promise<string> {
    const { data: tree } = await this.octokit.git.createTree({
      ...this.target(),
      base_tree: draft.headParentSha,
      tree: draft.changes.map((change) => ({
        content: change.content,
        mode: '100644' as const,
        path: change.path,
        type: 'blob' as const,
      })),
    })
    const { data: commit } = await this.octokit.git.createCommit({
      ...this.target(),
      message: draft.title,
      parents: [draft.headParentSha],
      tree: tree.sha,
    })
    return commit.sha
  }

  private async pointBranchAt(branch: string, sha: string, exists: boolean): Promise<void> {
    if (!exists) {
      try {
        await this.octokit.git.createRef({ ...this.target(), ref: `refs/heads/${branch}`, sha })
        return
      } catch (error) {
        // A closed pull request can leave its branch behind, and then it is simply overwritten.
        if ((error as { status?: number }).status !== 422) {
          throw error
        }
      }
    }
    await this.octokit.git.updateRef({ ...this.target(), force: true, ref: `heads/${branch}`, sha })
  }

  private async pullRequestsFrom(branch: string, state: 'closed' | 'open'): Promise<GitHubPullRequest[]> {
    const { data } = await this.octokit.pulls.list({
      ...this.target(),
      base: branch,
      direction: 'desc',
      head: `${this.owner}:${releaseBranchOf(branch)}`,
      per_page: 30,
      sort: 'updated',
      state,
    })
    return data
  }

  private target() {
    return { owner: this.owner, repo: this.repo }
  }
}

function toReleasePullRequest(pullRequest: Omit<GitHubPullRequest, 'merged_at'>): ReleasePullRequest {
  return {
    body: pullRequest.body,
    mergeCommitSha: pullRequest.merge_commit_sha,
    number: pullRequest.number,
    url: pullRequest.html_url,
  }
}
