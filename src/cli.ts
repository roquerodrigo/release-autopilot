import { parseArgs } from 'node:util'

import type { Reporter } from './application/ports.ts'

import { ReleaseAutopilot } from './release-autopilot.ts'

export interface CommandLineOutput {
  error(text: string): void
  write(text: string): void
}

const USAGE = `Usage: release-autopilot [options]

Keeps the release pull request of a GitHub repository up to date, and publishes the
release once it is merged. Prints the outcome as JSON.

Options:
  --repository <owner/name>      Repository to release. Defaults to GITHUB_REPOSITORY.
  --dry-run                      Plans the release and writes its notes, changing nothing.
  --preview-previous-tag <tag>   With --preview-release-tag, prints the notes of a past
  --preview-release-tag <tag>    release and changes nothing.
  --help                         Prints this text.

Environment:
  GITHUB_TOKEN or GH_TOKEN       Token with contents and pull-requests write access.
  ANTHROPIC_API_KEY              Key for the Claude API.
`

export async function runCommandLine(
  argumentList: readonly string[],
  environment: Record<string, string | undefined>,
  output: CommandLineOutput,
  fetchImplementation?: typeof fetch,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...argumentList],
      options: {
        'dry-run': { type: 'boolean' },
        'help': { type: 'boolean' },
        'preview-previous-tag': { type: 'string' },
        'preview-release-tag': { type: 'string' },
        'repository': { type: 'string' },
      },
      strict: true,
    })
    if (values.help) {
      output.write(USAGE)
      return 0
    }
    const previousTag = values['preview-previous-tag']
    const releaseTag = values['preview-release-tag']
    if (Boolean(previousTag) !== Boolean(releaseTag)) {
      throw new Error('--preview-previous-tag and --preview-release-tag go together')
    }
    const autopilot = new ReleaseAutopilot({
      anthropicApiKey: required(environment, 'ANTHROPIC_API_KEY'),
      dryRun: values['dry-run'],
      fetch: fetchImplementation,
      reporter: reporterOn(output),
      repository: values.repository ?? required(environment, 'GITHUB_REPOSITORY', '--repository'),
      token: environment.GITHUB_TOKEN || required(environment, 'GH_TOKEN', 'GITHUB_TOKEN'),
    })
    if (previousTag && releaseTag) {
      output.write(await autopilot.previewPastRelease(previousTag, releaseTag))
      return 0
    }
    const { published, pullRequest } = await autopilot.release()
    output.write(`${JSON.stringify({
      pullRequest: pullRequest?.url || null,
      released: published !== undefined,
      tag: published?.tag ?? null,
      version: published?.version ?? null,
    })}\n`)
    return 0
  } catch (error) {
    output.error(`release-autopilot: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function reporterOn(output: CommandLineOutput): Reporter {
  return {
    info: (message) => output.error(`${message}\n`),
    warning: (message) => output.error(`warning: ${message}\n`),
  }
}

function required(environment: Record<string, string | undefined>, name: string, alternative?: string): string {
  const value = environment[name]
  if (!value) {
    throw new Error(`set ${alternative ? `${alternative} or ${name}` : name}`)
  }
  return value
}
