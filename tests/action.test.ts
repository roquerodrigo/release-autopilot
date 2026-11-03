import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { runAction } from '../src/action.ts'
import { pullRequestBodyOf } from '../src/domain/release-documents.ts'
import { claudeAnswer } from './fake-claude.ts'
import { fakeGitHub, type FakeRepository, type RecordedWrite } from './fake-github.ts'

const INPUTS: Record<string, string> = {
  'INPUT_ANTHROPIC-API-KEY': 'key',
  'INPUT_DRY-RUN': 'false',
  'INPUT_PREVIEW-PREVIOUS-TAG': '',
  'INPUT_PREVIEW-RELEASE-TAG': '',
  'INPUT_REPOSITORY': 'owner/project',
  'INPUT_TOKEN': 'token',
}
const NOTES = JSON.stringify({
  entries: [{ category: 'fixed', pull_requests: [], text: { en: 'Fixed the login crash.' } }],
  summary: { en: '' },
})
const NOTHING_RELEVANT = JSON.stringify({ entries: [], summary: { en: '' } })
const RELEASED = { message: 'chore(main): release 1.0.0', sha: 'released' }
const FIX = { message: 'fix: the login crash', sha: 'fix' }

describe('the action', () => {
  let directory: string
  let outputFile: string
  let summaryFile: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'release-autopilot-'))
    outputFile = join(directory, 'output')
    summaryFile = join(directory, 'summary')
    writeFileSync(outputFile, '')
    writeFileSync(summaryFile, '')
    Object.assign(process.env, INPUTS, { GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile })
  })

  afterEach(() => {
    rmSync(directory, { recursive: true })
    for (const name of [...Object.keys(INPUTS), 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY']) {
      delete process.env[name]
    }
  })

  const run = async (repository: FakeRepository, notes = NOTES) => {
    const writes: RecordedWrite[] = []
    const github = fakeGitHub(repository, writes)
    await runAction(async (input, init) =>
      new URL(String(input)).hostname === 'api.anthropic.com' ? claudeAnswer(notes) : github(input, init))
    return writes
  }

  const output = (name: string) =>
    new RegExp(`^${name}<<(\\S+)\\n([^]*?)\\n?\\1$`, 'm').exec(readFileSync(outputFile, 'utf8'))?.[2]

  const mergedRelease = (version: string) => ({
    body: pullRequestBodyOf(`## ${version}\n\nNotes.`, { fingerprint: 'f', version }),
    head: 'release/main',
    html_url: 'https://github.test/pull/1',
    merge_commit_sha: 'released',
    merged_at: '2026-11-02T00:00:00Z',
    number: 1,
    state: 'closed' as const,
    title: `chore(main): release ${version}`,
  })

  it('opens the release pull request with its notes and its version files', async () => {
    const writes = await run({
      commits: [FIX, RELEASED],
      files: { 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\nOld.\n', 'package.json': '{\n  "version": "1.0.0"\n}\n' },
      releases: [{ sha: 'released', tag: 'v1.0.0' }],
    })
    const tree = writes.find((write) => write.path === 'git/trees')?.body.tree as { content: string, path: string }[]
    assert.deepEqual(tree.map((file) => file.path).sort(), ['CHANGELOG.md', 'package.json'])
    assert.match(tree.find((file) => file.path === 'package.json')!.content, /"version": "1\.0\.1"/)
    assert.match(tree.find((file) => file.path === 'CHANGELOG.md')!.content, /## \[1\.0\.1\][^]*Fixed the login crash\.[^]*## 1\.0\.0/)
    const pullRequest = writes.find((write) => write.path === 'pulls')?.body
    assert.equal(pullRequest?.title, 'chore(main): release 1.0.1')
    assert.match(String(pullRequest?.body), /Fixed the login crash\.[^]*### Support[^]*<!-- release-autopilot: /)
    assert.equal(output('released'), 'false')
    assert.equal(output('pull-request'), 'https://github.test/pull/7')
  })

  it('publishes what was merged, and opens nothing when nothing follows it', async () => {
    const writes = await run({
      commits: [RELEASED],
      files: {},
      pullRequests: [mergedRelease('1.0.0')],
    })
    assert.deepEqual(writes.map((write) => write.path), ['releases'])
    assert.equal(writes[0].body.tag_name, 'v1.0.0')
    assert.equal(writes[0].body.target_commitish, 'released')
    assert.equal(output('released'), 'true')
    assert.equal(output('tag'), 'v1.0.0')
    assert.equal(output('version'), '1.0.0')
    assert.equal(output('pull-request'), '')
  })

  it('changes nothing and reports nothing as published on a dry run', async () => {
    process.env['INPUT_DRY-RUN'] = 'true'
    const writes = await run({
      commits: [FIX, RELEASED],
      files: {},
      pullRequests: [mergedRelease('1.0.0')],
    })
    assert.deepEqual(writes, [])
    assert.equal(output('released'), 'false')
    assert.equal(output('tag'), '')
    assert.equal(output('version'), '')
  })

  it('opens nothing when the model finds nothing relevant', async () => {
    const writes = await run({
      commits: [FIX, RELEASED],
      files: {},
      releases: [{ sha: 'released', tag: 'v1.0.0' }],
    }, NOTHING_RELEVANT)
    assert.deepEqual(writes, [])
    assert.equal(output('pull-request'), '')
  })

  it('refuses a version that already has its tag', async () => {
    await assert.rejects(run({
      commits: [FIX, RELEASED],
      files: {},
      releases: [{ sha: 'released', tag: 'v1.0.0' }],
      tags: [{ sha: 'elsewhere', tag: 'v1.0.1' }],
    }), /v1\.0\.1 already exists/)
  })

  it('writes the notes of a past release to the summary and changes nothing', async () => {
    process.env['INPUT_PREVIEW-PREVIOUS-TAG'] = 'v1.0.0'
    process.env['INPUT_PREVIEW-RELEASE-TAG'] = 'v1.1.0'
    const writes = await run({ commits: [FIX], files: {} })
    assert.deepEqual(writes, [])
    assert.match(readFileSync(summaryFile, 'utf8'), /Fixed the login crash\./)
  })

  it('needs the key of the model', async () => {
    process.env['INPUT_ANTHROPIC-API-KEY'] = ''
    await assert.rejects(run({ commits: [], files: {} }), /anthropic-api-key/)
  })
})
