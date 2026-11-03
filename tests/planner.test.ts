import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ReleasePlan } from '../src/domain/release-plan.ts'
import type { StructuredVersionFile } from '../src/domain/version-file.ts'

import { ReleasePleasePlanner } from '../src/infrastructure/release-please-planner.ts'
import { fakeGitHub, type FakeRepository } from './fake-github.ts'
import { RecordingReporter } from './support.ts'

const RELEASED = { message: 'chore(main): release 1.0.0', sha: 'released' }
const FIX = { message: 'fix: a bug', sha: 'fix' }
const LAST_RELEASE = { releases: [{ sha: 'released', tag: 'v1.0.0' }] }

function jsonFile(path: string, jsonPath: string): StructuredVersionFile {
  return { format: 'json', jsonPath, kind: 'structured', path }
}

function plan(repository: FakeRepository, versionFiles: StructuredVersionFile[] = []): Promise<ReleasePlan | undefined> {
  return new ReleasePleasePlanner('owner/project', 'token', new RecordingReporter(), fakeGitHub(repository))
    .plan({ branch: 'main', initialVersion: undefined, versionFiles })
}

describe('ReleasePleasePlanner', () => {
  it('hands over every commit since the last tag, once, conventional or not', async () => {
    const planned = await plan({
      ...LAST_RELEASE,
      commits: [
        { message: 'Fix the login crash', sha: 'not-conventional' },
        { message: 'deps(deps): bump a\n\nSigned-off-by: dependabot[bot] <support@github.com>', sha: 'with-footer' },
        { message: 'feat: add a thing', sha: 'feature' },
        RELEASED,
        { message: 'feat: already released', sha: 'older' },
      ],
    })
    assert.equal(planned?.version, '1.1.0')
    assert.equal(planned?.previousTag, 'v1.0.0')
    assert.deepEqual(planned?.commits, [
      { isBreaking: false, sha: 'not-conventional' },
      { isBreaking: false, sha: 'with-footer' },
      { isBreaking: false, sha: 'feature' },
    ])
  })

  it('takes from the engine what makes a commit breaking', async () => {
    const planned = await plan({
      ...LAST_RELEASE,
      commits: [
        { message: 'feat: real\n\nBEGIN_NESTED_COMMIT\nfix!: nested\nEND_NESTED_COMMIT', sha: 'nested' },
        { message: 'fix: a\n\nBREAKING CHANGE #12 removes it', sha: 'numbered-footer' },
        { message: 'feat!: marked', sha: 'marked' },
        { message: 'fix: plain', sha: 'plain' },
        RELEASED,
      ],
    })
    assert.equal(planned?.version, '2.0.0')
    assert.deepEqual(planned?.commits, [
      { isBreaking: true, sha: 'nested' },
      { isBreaking: true, sha: 'numbered-footer' },
      { isBreaking: true, sha: 'marked' },
      { isBreaking: false, sha: 'plain' },
    ])
  })

  it('updates a version file and leaves out the one the engine looks for on its own', async () => {
    const planned = await plan({
      ...LAST_RELEASE,
      commits: [FIX, RELEASED],
      files: { 'manifest.json': '{\n  "version": "1.0.0"\n}\n' },
    }, [jsonFile('manifest.json', '$.version')])
    assert.deepEqual(planned?.fileChanges, [{ content: '{\n  "version": "1.0.1"\n}\n', path: 'manifest.json' }])
  })

  it('accepts a file already at the new version', async () => {
    const planned = await plan({
      ...LAST_RELEASE,
      commits: [FIX, RELEASED],
      files: { 'manifest.json': '{\n  "version": "1.0.1"\n}\n' },
    }, [jsonFile('manifest.json', '$.version')])
    assert.equal(planned?.fileChanges[0].content, '{\n  "version": "1.0.1"\n}\n')
  })

  it('fails when a selector matches nothing, even with the version elsewhere in the file', async () => {
    const repository = {
      ...LAST_RELEASE,
      commits: [FIX, RELEASED],
      files: { 'manifest.json': '{\n  "dependency": "1.0.1"\n}\n' },
    }
    await assert.rejects(plan(repository, [jsonFile('manifest.json', '$.version')]), /manifest\.json did not take the version 1\.0\.1/)
  })

  it('plans nothing with no conventional commit to take a version from', async () => {
    assert.equal(await plan({ ...LAST_RELEASE, commits: [{ message: 'Fix a crash', sha: 'a' }, RELEASED] }), undefined)
  })

  it('plans nothing when the last commit is the release', async () => {
    assert.equal(await plan({ ...LAST_RELEASE, commits: [RELEASED] }), undefined)
  })
})
