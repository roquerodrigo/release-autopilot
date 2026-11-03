import type { Octokit } from '@octokit/rest'

import type { RepositoryReader } from '../application/ports.ts'
import type { CommitSummary } from '../domain/release-plan.ts'
import type { CommitDetails } from '../domain/release-source.ts'

import { isReleaseTag } from '../domain/release-plan.ts'

const NOT_FOUND = 404

export class GitHubRepositoryReader implements RepositoryReader {
  readonly repository: string
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

  constructor(octokit: Octokit, repository: string) {
    this.octokit = octokit
    this.repository = repository
    const [owner, repo] = repository.split('/')
    this.owner = owner
    this.repo = repo
  }

  async commitDetails(sha: string): Promise<CommitDetails> {
    const { data: commit } = await this.octokit.repos.getCommit({ owner: this.owner, ref: sha, repo: this.repo })
    const { data: pullRequests } = await this.octokit.repos.listPullRequestsAssociatedWithCommit({
      commit_sha: sha,
      owner: this.owner,
      repo: this.repo,
    })
    const pullRequest = pullRequests.find((item) => item.merged_at)
    return {
      authorLogin: commit.author?.login,
      files: (commit.files ?? []).map((file) => ({
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch ?? '',
        path: file.filename,
      })),
      message: commit.commit.message,
      pullRequest: pullRequest && {
        body: pullRequest.body,
        number: pullRequest.number,
        title: pullRequest.title,
      },
    }
  }

  async commitsBetween(base: string, head: string): Promise<CommitSummary[]> {
    const commits: CommitSummary[] = []
    for (let page = 1; ; page += 1) {
      const { data } = await this.octokit.repos.compareCommitsWithBasehead({
        basehead: `${base}...${head}`,
        owner: this.owner,
        page,
        per_page: 100,
        repo: this.repo,
      })
      commits.push(...data.commits.map((commit) => ({ message: commit.commit.message, sha: commit.sha })))
      if (commits.length >= data.total_commits || data.commits.length === 0) {
        return commits
      }
    }
  }

  async defaultBranch(): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner: this.owner, repo: this.repo })
    return data.default_branch
  }

  async fileAt(path: string, ref: string): Promise<string | undefined> {
    return this.orUndefinedWhenMissing(async () => {
      const { data } = await this.octokit.repos.getContent({
        mediaType: { format: 'raw' },
        owner: this.owner,
        path,
        ref,
        repo: this.repo,
      })
      return data as unknown as string
    })
  }

  async firstParentOf(ref: string): Promise<string> {
    const { data } = await this.octokit.repos.getCommit({ owner: this.owner, ref, repo: this.repo })
    return data.parents[0].sha
  }

  async hasReleaseTag(): Promise<boolean> {
    const { data } = await this.octokit.git.listMatchingRefs({ owner: this.owner, per_page: 100, ref: 'tags/v', repo: this.repo })
    return data.some(({ ref }) => isReleaseTag(ref.slice('refs/tags/'.length)))
  }

  async headOf(branch: string): Promise<string> {
    const { data } = await this.octokit.repos.getBranch({ branch, owner: this.owner, repo: this.repo })
    return data.commit.sha
  }

  async pathsAt(ref: string): Promise<string[]> {
    const { data } = await this.octokit.git.getTree({
      owner: this.owner,
      recursive: 'true',
      repo: this.repo,
      tree_sha: ref,
    })
    return data.tree.flatMap((entry) => entry.type === 'blob' && entry.path ? [entry.path] : [])
  }

  async tagExists(tag: string): Promise<boolean> {
    const reference = await this.orUndefinedWhenMissing(() =>
      this.octokit.git.getRef({ owner: this.owner, ref: `tags/${tag}`, repo: this.repo }))
    return reference !== undefined
  }

  private async orUndefinedWhenMissing<Result>(request: () => Promise<Result>): Promise<Result | undefined> {
    try {
      return await request()
    } catch (error) {
      if ((error as { status?: number }).status === NOT_FOUND) {
        return undefined
      }
      throw error
    }
  }
}
