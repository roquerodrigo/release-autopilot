import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'

import type { ReleasePublisher, Reporter } from './application/ports.ts'
import type { ReleaseOutcome } from './application/run-release.ts'

import { PrepareReleasePullRequest } from './application/prepare-release-pull-request.ts'
import { PreviewPastRelease } from './application/preview-past-release.ts'
import { PublishMergedRelease } from './application/publish-merged-release.ts'
import { runRelease } from './application/run-release.ts'
import { ClaudeNotesAuthor } from './infrastructure/claude-notes-author.ts'
import { DryRunReleasePublisher } from './infrastructure/dry-run-release-publisher.ts'
import { GitHubReleasePublisher } from './infrastructure/github-release-publisher.ts'
import { GitHubRepositoryReader } from './infrastructure/github-repository-reader.ts'
import { ReleasePleasePlanner } from './infrastructure/release-please-planner.ts'

export interface ReleaseAutopilotOptions {
  anthropicApiKey: string
  dryRun?: boolean
  fetch?: typeof fetch
  reporter?: Reporter
  repository: string
  token: string
}

const consoleReporter: Reporter = {
  info: (message) => console.info(message),
  warning: (message) => console.warn(message),
}

export class ReleaseAutopilot {
  private readonly author: ClaudeNotesAuthor
  private readonly octokit: Octokit
  private readonly options: ReleaseAutopilotOptions
  private readonly reader: GitHubRepositoryReader
  private readonly reporter: Reporter

  constructor(options: ReleaseAutopilotOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
      throw new Error(`The repository must be given as owner/name, not "${options.repository}"`)
    }
    for (const [name, value] of [['anthropicApiKey', options.anthropicApiKey], ['token', options.token]]) {
      if (!value) {
        throw new Error(`${name} is required`)
      }
    }
    this.options = options
    this.reporter = options.reporter ?? consoleReporter
    this.author = new ClaudeNotesAuthor(new Anthropic({ apiKey: options.anthropicApiKey, fetch: options.fetch }), this.reporter)
    this.octokit = new Octokit({
      auth: options.token,
      log: { debug() {}, error() {}, info() {}, warn() {} },
      request: { fetch: options.fetch },
    })
    this.reader = new GitHubRepositoryReader(this.octokit, options.repository)
  }

  previewPastRelease(previousTag: string, releaseTag: string): Promise<string> {
    return new PreviewPastRelease(this.reader, this.author).run(previousTag, releaseTag)
  }

  async release(): Promise<ReleaseOutcome> {
    const { dryRun, fetch, repository, token } = this.options
    const actualPublisher = new GitHubReleasePublisher(this.octokit, repository, this.reporter)
    const publisher: ReleasePublisher = dryRun ?
        new DryRunReleasePublisher(actualPublisher, this.reporter) :
      actualPublisher
    const branch = await this.reader.defaultBranch()
    return runRelease(
      branch,
      new PublishMergedRelease(this.reader, publisher, this.reporter),
      new PrepareReleasePullRequest({
        author: this.author,
        clock: () => new Date(),
        planner: new ReleasePleasePlanner(repository, token, this.reporter, fetch),
        publisher,
        reader: this.reader,
        reporter: this.reporter,
      }),
      this.reporter,
    )
  }
}
