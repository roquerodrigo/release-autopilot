import * as core from '@actions/core'
import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'

import type { ReleasePublisher, Reporter } from './application/ports.ts'

import { PrepareReleasePullRequest } from './application/prepare-release-pull-request.ts'
import { PreviewPastRelease } from './application/preview-past-release.ts'
import { PublishMergedRelease } from './application/publish-merged-release.ts'
import { runRelease } from './application/run-release.ts'
import { ClaudeNotesAuthor } from './infrastructure/claude-notes-author.ts'
import { DryRunReleasePublisher } from './infrastructure/dry-run-release-publisher.ts'
import { GitHubReleasePublisher } from './infrastructure/github-release-publisher.ts'
import { GitHubRepositoryReader } from './infrastructure/github-repository-reader.ts'
import { ReleasePleasePlanner } from './infrastructure/release-please-planner.ts'

const reporter: Reporter = {
  info: (message) => core.info(message),
  warning: (message) => core.warning(message),
}

export async function runAction(fetchImplementation?: typeof fetch): Promise<void> {
  const repository = core.getInput('repository', { required: true })
  const token = core.getInput('token', { required: true })
  const author = new ClaudeNotesAuthor(new Anthropic({ apiKey: core.getInput('anthropic-api-key', { required: true }), fetch: fetchImplementation }))
  const octokit = new Octokit({
    auth: token,
    log: { debug() {}, error() {}, info() {}, warn() {} },
    request: { fetch: fetchImplementation },
  })
  const reader = new GitHubRepositoryReader(octokit, repository)

  const previousTag = core.getInput('preview-previous-tag')
  const releaseTag = core.getInput('preview-release-tag')
  if (previousTag && releaseTag) {
    const preview = await new PreviewPastRelease(reader, author).run(previousTag, releaseTag)
    core.info(preview)
    await core.summary.addRaw(preview).write()
    return
  }

  const actualPublisher = new GitHubReleasePublisher(octokit, repository)
  const publisher: ReleasePublisher = core.getBooleanInput('dry-run') ?
      new DryRunReleasePublisher(actualPublisher, reporter) :
    actualPublisher
  const branch = await reader.defaultBranch()
  const { published, pullRequest } = await runRelease(
    branch,
    new PublishMergedRelease(reader, publisher, reporter),
    new PrepareReleasePullRequest({
      author,
      clock: () => new Date(),
      planner: new ReleasePleasePlanner(repository, token, reporter, fetchImplementation),
      publisher,
      reader,
      reporter,
    }),
    reporter,
  )
  core.setOutput('released', String(published !== undefined))
  core.setOutput('tag', published?.tag ?? '')
  core.setOutput('version', published?.version ?? '')
  core.setOutput('pull-request', pullRequest?.url ?? '')
}
