import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { PrepareReleasePullRequest } from '../src/application/prepare-release-pull-request.ts'
import { PreviewPastRelease } from '../src/application/preview-past-release.ts'
import { PublishMergedRelease } from '../src/application/publish-merged-release.ts'
import { runRelease } from '../src/application/run-release.ts'
import { VersionFileDetector } from '../src/application/version-file-detector.ts'
import { RejectedNotesError } from '../src/domain/errors.ts'
import { ProjectConfiguration } from '../src/domain/project-configuration.ts'
import { pullRequestBodyOf, stateOfPullRequest } from '../src/domain/release-documents.ts'
import { notesFingerprint, type ReleasePlan } from '../src/domain/release-plan.ts'
import { DryRunReleasePublisher } from '../src/infrastructure/dry-run-release-publisher.ts'
import {
  FixedAuthor,
  FixedPlanner,
  InMemoryReader,
  RecordingPublisher,
  RecordingReporter,
  writtenEntry,
  writtenNotes,
} from './support.ts'

const PLAN: ReleasePlan = {
  commits: [{ isBreaking: false, sha: 'a' }],
  fileChanges: [{ content: '{"version":"1.1.0"}', path: 'manifest.json' }],
  previousTag: 'v1.0.0',
  version: '1.1.0',
}
const NOTES = writtenNotes(writtenEntry('added', 'Added a thing.'))
const FINGERPRINT = notesFingerprint({
  commitShas: ['a'],
  configuration: undefined,
  hacsManifest: undefined,
  version: '1.1.0',
})

describe('PrepareReleasePullRequest', () => {
  let reader: InMemoryReader
  let publisher: RecordingPublisher
  let reporter: RecordingReporter

  const prepare = (plan: ReleasePlan | undefined, author = new FixedAuthor(NOTES), planner = new FixedPlanner(plan)) =>
    new PrepareReleasePullRequest({
      author,
      clock: () => new Date('2026-11-02T12:00:00Z'),
      planner,
      publisher,
      reader,
      reporter,
    })

  beforeEach(() => {
    reader = new InMemoryReader()
    publisher = new RecordingPublisher()
    reporter = new RecordingReporter()
  })

  it('opens the pull request with its final notes on the first write', async () => {
    reader.files.set('CHANGELOG.md', '# Changelog\n\n## 1.0.0\n\nOld.\n')
    await prepare(PLAN).run('main')

    const [draft] = publisher.written
    assert.equal(publisher.written.length, 1)
    assert.equal(draft.title, 'chore(main): release 1.1.0')
    assert.equal(draft.head, 'release/main')
    assert.equal(draft.base, 'main')
    assert.equal(draft.headParentSha, 'head')
    assert.match(draft.body, /^## \[1\.1\.0\]\(https:\/\/github\.com\/owner\/project\/compare\/v1\.0\.0\.\.\.v1\.1\.0\) \(2026-11-02\)/)
    assert.match(draft.body, /### New features\n\n- Added a thing\./)
    assert.match(draft.body, /### Support/)
    assert.deepEqual(stateOfPullRequest(draft.body), { fingerprint: FINGERPRINT, version: '1.1.0' })

    const changelog = draft.changes.find((change) => change.path === 'CHANGELOG.md')!.content
    assert.match(changelog, /^# Changelog\n\n## \[1\.1\.0\]/)
    assert.match(changelog, /## 1\.0\.0\n\nOld\./)
    assert.doesNotMatch(changelog, /### Support/)
    assert.ok(draft.changes.some((change) => change.path === 'manifest.json'))
  })

  it('leaves the support section out when the project turns it off', async () => {
    reader.files.set('.release-autopilot.yml', 'support: false\n')
    await prepare(PLAN).run('main')
    assert.doesNotMatch(publisher.written[0].body, /### Support/)
    assert.match(publisher.written[0].body, /- Added a thing\.\n\n<!-- release-autopilot/)
  })

  it('never touches the pull request when the notes cannot be written', async () => {
    publisher.open = { body: 'previous', mergeCommitSha: null, number: 1, url: 'u' }
    await assert.rejects(prepare(PLAN, new FixedAuthor(new Error('overloaded'))).run('main'), /overloaded/)
    assert.equal(publisher.written.length, 0)
  })

  it('never touches the pull request when the notes are rejected', async () => {
    const author = new FixedAuthor(writtenNotes(writtenEntry('added', 'See https://evil.test')))
    await assert.rejects(prepare(PLAN, author).run('main'), RejectedNotesError)
    assert.equal(publisher.written.length, 0)
  })

  it('neither calls the model nor writes when the notes are still current', async () => {
    const author = new FixedAuthor(NOTES)
    const open = {
      body: pullRequestBodyOf('text', { fingerprint: FINGERPRINT, version: '1.1.0' }),
      mergeCommitSha: null,
      number: 1,
      url: 'u',
    }
    publisher.open = open
    assert.equal(await prepare(PLAN, author).run('main'), open)
    assert.equal(author.calls, 0)
    assert.equal(publisher.written.length, 0)
  })

  it('writes again when a commit arrives', async () => {
    const author = new FixedAuthor(NOTES)
    publisher.open = {
      body: pullRequestBodyOf('text', { fingerprint: 'stale', version: '1.1.0' }),
      mergeCommitSha: null,
      number: 1,
      url: 'u',
    }
    await prepare(PLAN, author).run('main')
    assert.equal(author.calls, 1)
    assert.equal(publisher.written.length, 1)
  })

  it('closes the pull request when nothing is left to release', async () => {
    const open = { body: 'x', mergeCommitSha: null, number: 1, url: 'u' }
    publisher.open = open
    assert.equal(await prepare(undefined).run('main'), undefined)
    assert.deepEqual(publisher.closed, [open])
    assert.equal(publisher.written.length, 0)
  })

  it('opens nothing when the model finds nothing relevant', async () => {
    assert.equal(await prepare(PLAN, new FixedAuthor(writtenNotes())).run('main'), undefined)
    assert.equal(publisher.written.length, 0)
    assert.deepEqual(publisher.closed, [])
  })

  it('closes the pull request when the model no longer finds anything relevant', async () => {
    const open = { body: 'x', mergeCommitSha: null, number: 1, url: 'u' }
    publisher.open = open
    assert.equal(await prepare(PLAN, new FixedAuthor(writtenNotes())).run('main'), undefined)
    assert.deepEqual(publisher.closed, [open])
    assert.equal(publisher.written.length, 0)
  })

  it('fails when the model finds nothing relevant in a breaking commit', async () => {
    const breakingPlan = { ...PLAN, commits: [{ isBreaking: true, sha: 'a' }] }
    await assert.rejects(prepare(breakingPlan, new FixedAuthor(writtenNotes())).run('main'), RejectedNotesError)
    assert.deepEqual(publisher.closed, [])
  })

  it('does nothing when there is nothing to release and nothing open', async () => {
    assert.equal(await prepare(undefined).run('main'), undefined)
    assert.deepEqual(publisher.closed, [])
  })

  it('writes every changelog and each file of a release', async () => {
    reader.files.set('.release-autopilot.yml', `
changelogs:
  - language: pt-BR
  - language: en
    path: docs/CHANGELOG.en.md
    release_path: docs/en/{version}.md
`)
    await prepare(PLAN).run('main')
    const paths = publisher.written[0].changes.map((change) => change.path)
    assert.deepEqual(paths.sort(), ['CHANGELOG.md', 'docs/CHANGELOG.en.md', 'docs/en/1.1.0.md', 'manifest.json'])
  })

  it('applies the pattern of a declared version file and hands the rest to the planner', async () => {
    reader.files.set('.release-autopilot.yml', `
version_files:
  - path: SKILL.md
    pattern: '^version: (\\S+)'
  - path: src/manifest.json
    json_path: $.version
`)
    reader.files.set('SKILL.md', 'version: 1.0.0\n')
    reader.files.set('src/manifest.json', '{"version":"1.0.0"}')
    const planner = new FixedPlanner(PLAN)
    await prepare(PLAN, new FixedAuthor(NOTES), planner).run('main')
    assert.deepEqual(planner.requests[0].versionFiles.map((file) => file.path), ['src/manifest.json'])
    const skill = publisher.written[0].changes.find((change) => change.path === 'SKILL.md')
    assert.equal(skill?.content, 'version: 1.1.0\n')
  })

  it('fails before writing when the next version already has its tag', async () => {
    reader.tags.add('v1.1.0')
    const author = new FixedAuthor(NOTES)
    await assert.rejects(prepare(PLAN, author).run('main'), /v1\.1\.0 already exists/)
    assert.equal(author.calls, 0)
    assert.equal(publisher.written.length, 0)
  })

  it('fails before writing when the planner lost sight of the existing tags', async () => {
    reader.tags.add('v3.2.0')
    const restarted = { ...PLAN, previousTag: undefined, version: '1.0.0' }
    await assert.rejects(prepare(restarted).run('main'), /would restart at 1\.0\.0/)
    assert.equal(publisher.written.length, 0)
  })

  it('lets the first version be chosen when the planner lost sight of the tags', async () => {
    reader.tags.add('v3.2.0')
    reader.files.set('.release-autopilot.yml', 'initial_version: 3.3.0\n')
    await prepare({ ...PLAN, previousTag: undefined, version: '3.3.0' }).run('main')
    assert.equal(publisher.written.length, 1)
  })

  it('opens the first release of a repository with no release tag', async () => {
    reader.tags.add('nightly')
    await prepare({ ...PLAN, previousTag: undefined, version: '1.0.0' }).run('main')
    assert.equal(publisher.written.length, 1)
  })

  it('fails before writing when a declared version file does not exist', async () => {
    reader.files.set('.release-autopilot.yml', 'version_files:\n  - path: missing.json\n    json_path: $.version\n')
    await assert.rejects(prepare(PLAN).run('main'), /version files that do not exist: missing\.json/)
    assert.equal(publisher.written.length, 0)
  })

  it('fails before writing when the project configuration cannot be used', async () => {
    reader.files.set('.release-autopilot.yml', 'unknown: 1')
    await assert.rejects(prepare(PLAN).run('main'), /unknown fields: unknown/)
    assert.equal(publisher.written.length, 0)
  })
})

describe('PublishMergedRelease', () => {
  const merged = (version: string) => ({
    body: pullRequestBodyOf(`## ${version}\n\nNotes.\n\n### Support\n\nHelp.`, { fingerprint: 'f', version }),
    mergeCommitSha: 'merged',
    number: 1,
    url: 'u',
  })

  it('publishes the merged release from the text of the pull request', async () => {
    const publisher = new RecordingPublisher()
    publisher.merged = merged('1.1.0')
    const published = await new PublishMergedRelease(new InMemoryReader(), publisher, new RecordingReporter()).run('main')
    assert.deepEqual(published, { tag: 'v1.1.0', version: '1.1.0' })
    assert.deepEqual(publisher.releases, [{
      body: '## 1.1.0\n\nNotes.\n\n### Support\n\nHelp.\n',
      tag: 'v1.1.0',
      targetSha: 'merged',
    }])
  })

  it('reports nothing as published on a dry run, which only says what it would do', async () => {
    const actual = new RecordingPublisher()
    actual.merged = merged('1.1.0')
    const reporter = new RecordingReporter()
    const dryRun = new DryRunReleasePublisher(actual, reporter)
    assert.equal(await new PublishMergedRelease(new InMemoryReader(), dryRun, reporter).run('main'), undefined)
    assert.deepEqual(actual.releases, [])
    assert.match(reporter.infos[0], /Dry run: would publish v1\.1\.0 at merged/)
  })

  it('publishes nothing twice', async () => {
    const reader = new InMemoryReader()
    reader.tags.add('v1.1.0')
    const publisher = new RecordingPublisher()
    publisher.merged = merged('1.1.0')
    assert.equal(await new PublishMergedRelease(reader, publisher, new RecordingReporter()).run('main'), undefined)
    assert.deepEqual(publisher.releases, [])
  })

  it('publishes nothing without a merged pull request', async () => {
    const publisher = new RecordingPublisher()
    assert.equal(await new PublishMergedRelease(new InMemoryReader(), publisher, new RecordingReporter()).run('main'), undefined)
  })

  it('warns about a pull request that lost its record', async () => {
    const publisher = new RecordingPublisher()
    const reporter = new RecordingReporter()
    publisher.merged = { body: 'edited', mergeCommitSha: 'merged', number: 1, url: 'u' }
    assert.equal(await new PublishMergedRelease(new InMemoryReader(), publisher, reporter).run('main'), undefined)
    assert.equal(reporter.warnings.length, 1)
    assert.deepEqual(publisher.releases, [])
  })
})

describe('a dry run', () => {
  it('neither closes nor writes a pull request', async () => {
    const actual = new RecordingPublisher()
    const reporter = new RecordingReporter()
    const dryRun = new DryRunReleasePublisher(actual, reporter)
    const open = { body: 'x', mergeCommitSha: null, number: 1, url: 'u' }
    await dryRun.closePullRequest(open)
    const draft = { base: 'main', body: 'notes', changes: [{ content: 'c', path: 'a' }], head: 'h', headParentSha: 'p', title: 't' }
    assert.equal(await dryRun.writePullRequest(draft, open), open)
    assert.equal((await dryRun.writePullRequest(draft, undefined)).url, '')
    assert.deepEqual(actual.closed, [])
    assert.deepEqual(actual.written, [])
  })

  it('reads what is really merged and open', async () => {
    const actual = new RecordingPublisher()
    actual.open = { body: 'x', mergeCommitSha: null, number: 1, url: 'u' }
    const dryRun = new DryRunReleasePublisher(actual, new RecordingReporter())
    assert.equal(await dryRun.findOpenPullRequest('main'), actual.open)
    assert.equal(await dryRun.findLatestMergedPullRequest('main'), undefined)
  })
})

describe('runRelease', () => {
  const failingPrepare = { run: async () => {
    throw new Error('model down')
  } } as unknown as PrepareReleasePullRequest
  const publishing = (result: undefined | { tag: string, version: string }) =>
    ({ run: async () => result }) as unknown as PublishMergedRelease

  it('does not let the next pull request hold back a release already cut', async () => {
    const reporter = new RecordingReporter()
    const release = { tag: 'v1.0.0', version: '1.0.0' }
    const outcome = await runRelease('main', publishing(release), failingPrepare, reporter)
    assert.deepEqual(outcome, { published: release, pullRequest: undefined })
    assert.match(reporter.warnings[0], /model down/)
  })

  it('fails when there is no release to protect', async () => {
    await assert.rejects(runRelease('main', publishing(undefined), failingPrepare, new RecordingReporter()), /model down/)
  })

  it('reports the pull request', async () => {
    const pullRequest = { body: '', mergeCommitSha: null, number: 1, url: 'u' }
    const prepare = { run: async () => pullRequest } as unknown as PrepareReleasePullRequest
    const outcome = await runRelease('main', publishing(undefined), prepare, new RecordingReporter())
    assert.equal(outcome.pullRequest, pullRequest)
  })
})

describe('PreviewPastRelease', () => {
  it('writes the notes of every commit and changes nothing', async () => {
    const reader = new InMemoryReader()
    reader.compared = [{ message: 'feat: a', sha: 'a' }, { message: 'ci: b', sha: 'b' }]
    const preview = await new PreviewPastRelease(reader, new FixedAuthor(NOTES)).run('v1.0.0', 'v1.1.0')
    assert.match(preview, /^# owner\/project \(en\)\n\n### New features\n\n- Added a thing\./)
  })

  it('requires a breaking entry for a breaking commit of the past', async () => {
    const reader = new InMemoryReader()
    reader.compared = [{ message: 'feat!: a', sha: 'a' }]
    await assert.rejects(new PreviewPastRelease(reader, new FixedAuthor(NOTES)).run('v1.0.0', 'v1.1.0'), RejectedNotesError)
  })
})

describe('PreviewPastRelease without anything relevant', () => {
  it('says that no release would open', async () => {
    const preview = await new PreviewPastRelease(new InMemoryReader(), new FixedAuthor(writtenNotes())).run('v1.0.0', 'v1.1.0')
    assert.match(preview, /no release would open/)
  })
})

describe('VersionFileDetector', () => {
  const detected = async (files: Record<string, string>, yaml?: string) => {
    const reader = new InMemoryReader()
    for (const [path, content] of Object.entries(files)) {
      reader.files.set(path, content)
    }
    const versionFiles = await new VersionFileDetector(reader).versionFilesAt('head', ProjectConfiguration.parse(yaml, 'en'))
    return versionFiles.map((file) => file.kind === 'structured' ? `${file.path} ${file.jsonPath}` : file.path)
  }

  it('finds the files of a Home Assistant integration', async () => {
    assert.deepEqual(await detected({
      'custom_components/x/manifest.json': '{}',
      'pyproject.toml': '[project]\nname = "ha_X.y"\nversion = "1.0.0"\n',
      'uv.lock': '',
    }), [
      'custom_components/x/manifest.json $.version',
      'pyproject.toml $.project.version',
      'uv.lock $.package[?(@.name.value=="ha-x-y")].version',
    ])
  })

  it('finds the files of an npm package', async () => {
    assert.deepEqual(await detected({ 'package-lock.json': '{}', 'package.json': '{"version":"1.0.0"}' }), [
      'package.json $.version',
      'package-lock.json $.version',
      'package-lock.json $.packages[\'\'].version',
    ])
  })

  it('leaves out a package with no version of its own', async () => {
    assert.deepEqual(await detected({ 'package.json': '{}', 'pyproject.toml': '[tool.ruff]\nline-length = 120\n' }), [])
    assert.deepEqual(await detected({ 'pyproject.toml': '[project]\nversion = "1"\ndynamic = ["version"]\n' }), [])
  })

  it('lets a declared file replace a detected one', async () => {
    const files = { 'package.json': '{"version":"1.0.0"}' }
    assert.deepEqual(
      await detected(files, 'version_files:\n  - path: package.json\n    json_path: $.custom\n'),
      ['package.json $.custom'],
    )
  })
})
