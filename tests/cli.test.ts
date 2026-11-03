import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { runCommandLine } from '../src/cli.ts'
import { pullRequestBodyOf } from '../src/domain/release-documents.ts'
import { ReleaseAutopilot } from '../src/index.ts'
import { claudeAnswer } from './fake-claude.ts'
import { fakeGitHub, type FakeRepository, type RecordedWrite } from './fake-github.ts'

const ENVIRONMENT = {
  ANTHROPIC_API_KEY: 'key',
  GITHUB_REPOSITORY: 'owner/project',
  GITHUB_TOKEN: 'token',
}
const NOTES = JSON.stringify({
  entries: [{ category: 'fixed', pull_requests: [], text: { en: 'Fixed the login crash.' } }],
  summary: { en: '' },
})
const RELEASED = { message: 'chore(main): release 1.0.0', sha: 'released' }
const FIX = { message: 'fix: the login crash', sha: 'fix' }
const UNRELEASED: FakeRepository = {
  commits: [FIX, RELEASED],
  files: {},
  releases: [{ sha: 'released', tag: 'v1.0.0' }],
}
const merged = (): FakeRepository => ({
  commits: [RELEASED],
  files: {},
  pullRequests: [{
    body: pullRequestBodyOf('## 1.0.0\n\nNotes.', { fingerprint: 'f', version: '1.0.0' }),
    head: 'release/main',
    html_url: 'https://github.test/pull/1',
    merge_commit_sha: 'released',
    merged_at: '2026-11-02T00:00:00Z',
    number: 1,
    state: 'closed',
    title: 'chore(main): release 1.0.0',
  }],
})

function fakeFetch(repository: FakeRepository, writes: RecordedWrite[] = []): typeof fetch {
  const github = fakeGitHub(repository, writes)
  return async (input, init) =>
    new URL(String(input)).hostname === 'api.anthropic.com' ? claudeAnswer(NOTES) : github(input, init)
}

async function run(
  argumentList: string[],
  repository: FakeRepository = UNRELEASED,
  environment: Record<string, string | undefined> = ENVIRONMENT,
) {
  const writes: RecordedWrite[] = []
  let errors = ''
  let written = ''
  const exitCode = await runCommandLine(argumentList, environment, {
    error: (text) => {
      errors += text
    },
    write: (text) => {
      written += text
    },
  }, fakeFetch(repository, writes))
  return { errors, exitCode, writes, written }
}

describe('the command line', () => {
  it('opens the release pull request and prints the outcome', async () => {
    const { errors, exitCode, writes, written } = await run([])
    assert.equal(exitCode, 0)
    assert.ok(writes.some((write) => write.path === 'pulls'))
    assert.deepEqual(JSON.parse(written), {
      pullRequest: 'https://github.test/pull/7',
      released: false,
      tag: null,
      version: null,
    })
    assert.match(errors, /Next version: 1\.0\.1/)
  })

  it('publishes what was merged into the repository it is given', async () => {
    const { exitCode, writes, written } = await run(['--repository', 'owner/project'], merged(), {
      ...ENVIRONMENT,
      GH_TOKEN: 'token',
      GITHUB_REPOSITORY: undefined,
      GITHUB_TOKEN: undefined,
    })
    assert.equal(exitCode, 0)
    assert.deepEqual(writes.map((write) => write.path), ['releases'])
    assert.deepEqual(JSON.parse(written), { pullRequest: null, released: true, tag: 'v1.0.0', version: '1.0.0' })
  })

  it('changes nothing on a dry run', async () => {
    const { exitCode, writes, written } = await run(['--dry-run'])
    assert.equal(exitCode, 0)
    assert.deepEqual(writes, [])
    assert.deepEqual(JSON.parse(written), { pullRequest: null, released: false, tag: null, version: null })
  })

  it('prints the notes of a past release', async () => {
    const { exitCode, writes, written } = await run(['--preview-previous-tag', 'v1.0.0', '--preview-release-tag', 'v1.1.0'])
    assert.equal(exitCode, 0)
    assert.deepEqual(writes, [])
    assert.match(written, /Fixed the login crash\./)
  })

  it('prints its usage', async () => {
    const { exitCode, written } = await run(['--help'], UNRELEASED, {})
    assert.equal(exitCode, 0)
    assert.match(written, /^Usage: release-autopilot/)
  })

  for (const [situation, argumentList, environment, message] of [
    ['the key of the model is missing', [], { ...ENVIRONMENT, ANTHROPIC_API_KEY: '' }, /set ANTHROPIC_API_KEY/],
    ['no token is set', [], { ...ENVIRONMENT, GITHUB_TOKEN: undefined }, /set GITHUB_TOKEN or GH_TOKEN/],
    ['no repository is given', [], { ...ENVIRONMENT, GITHUB_REPOSITORY: undefined }, /set --repository or GITHUB_REPOSITORY/],
    ['the repository is not owner/name', ['--repository', 'project'], ENVIRONMENT, /owner\/name, not "project"/],
    ['a preview names one tag only', ['--preview-release-tag', 'v1.1.0'], ENVIRONMENT, /go together/],
    ['an option is unknown', ['--force'], ENVIRONMENT, /Unknown option '--force'/],
  ] as const) {
    it(`fails when ${situation}`, async () => {
      const { errors, exitCode, writes } = await run([...argumentList], UNRELEASED, environment)
      assert.equal(exitCode, 1)
      assert.deepEqual(writes, [])
      assert.match(errors, message)
    })
  }
})

describe('the library', () => {
  it('reports to the console unless given a reporter', async (context) => {
    const info = context.mock.method(console, 'info', () => {})
    const outcome = await new ReleaseAutopilot({ ...options(), fetch: fakeFetch(merged()) }).release()
    assert.equal(outcome.published?.tag, 'v1.0.0')
    assert.ok(info.mock.calls.some((call) => call.arguments[0] === 'Published v1.0.0'))
  })

  it('needs a token', () => {
    assert.throws(() => new ReleaseAutopilot({ ...options(), token: '' }), /token is required/)
  })
})

function options() {
  return { anthropicApiKey: 'key', repository: 'owner/project', token: 'token' }
}
