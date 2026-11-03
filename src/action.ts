import * as core from '@actions/core'

import type { Reporter } from './application/ports.ts'

import { ReleaseAutopilot } from './release-autopilot.ts'

const reporter: Reporter = {
  info: (message) => core.info(message),
  warning: (message) => core.warning(message),
}

export async function runAction(fetchImplementation?: typeof fetch): Promise<void> {
  const autopilot = new ReleaseAutopilot({
    anthropicApiKey: core.getInput('anthropic-api-key', { required: true }),
    dryRun: core.getBooleanInput('dry-run'),
    fetch: fetchImplementation,
    reporter,
    repository: core.getInput('repository', { required: true }),
    token: core.getInput('token', { required: true }),
  })

  const previousTag = core.getInput('preview-previous-tag')
  const releaseTag = core.getInput('preview-release-tag')
  if (previousTag && releaseTag) {
    const preview = await autopilot.previewPastRelease(previousTag, releaseTag)
    core.info(preview)
    await core.summary.addRaw(preview).write()
    return
  }

  const { published, pullRequest } = await autopilot.release()
  core.setOutput('released', String(published !== undefined))
  core.setOutput('tag', published?.tag ?? '')
  core.setOutput('version', published?.version ?? '')
  core.setOutput('pull-request', pullRequest?.url ?? '')
}
