import { Octokit } from '@octokit/rest'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GitHubReleasePublisher } from '../src/infrastructure/github-release-publisher.ts'
import { GitHubRepositoryReader } from '../src/infrastructure/github-repository-reader.ts'
import { RecordingReporter } from './support.ts'

interface RecordedRequest {
  body: unknown
  method: string
  path: string
}

type Route = (request: RecordedRequest) => undefined | { data?: unknown, status?: number }

function gitHubStub(route: Route) {
  const requests: RecordedRequest[] = []
  const octokit = new Octokit({
    request: {
      fetch: async (url: string, options: { body?: string, method: string }) => {
        const { pathname, search } = new URL(url)
        const request = {
          body: options.body ? JSON.parse(options.body) : undefined,
          method: options.method,
          path: `${pathname}${search}`,
        }
        requests.push(request)
        const response = route(request) ?? {}
        const status = response.status ?? 200
        return new Response(status === 204 ? null : JSON.stringify(response.data ?? {}), {
          headers: { 'content-type': 'application/json' },
          status,
        })
      },
    },
  })
  return { octokit, requests }
}

const DRAFT = {
  base: 'main',
  body: 'notes',
  changes: [{ content: '1.1.0', path: 'version' }],
  head: 'release/main',
  headParentSha: 'parent',
  title: 'chore(main): release 1.1.0',
}
const PULL_REQUEST = { body: 'notes', html_url: 'https://github.test/pull/7', merge_commit_sha: null, number: 7 }

const creatingGitObjects: Route = ({ path }) => {
  if (path.endsWith('/git/trees')) {
    return { data: { sha: 'tree' }, status: 201 }
  }
  if (path.endsWith('/git/commits')) {
    return { data: { sha: 'commit' }, status: 201 }
  }
  return undefined
}

describe('GitHubReleasePublisher', () => {
  it('commits on top of the target, opens the branch and the pull request', async () => {
    const { octokit, requests } = gitHubStub((request) =>
      creatingGitObjects(request) ?? (request.path.endsWith('/pulls') ? { data: PULL_REQUEST, status: 201 } : { data: {}, status: 201 }))
    const reporter = new RecordingReporter()
    const pullRequest = await new GitHubReleasePublisher(octokit, 'o/r', reporter).writePullRequest(DRAFT, undefined)
    assert.deepEqual(reporter.infos, ['Opened https://github.test/pull/7, "chore(main): release 1.1.0", changing version'])

    assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), [
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'POST /repos/o/r/git/refs',
      'POST /repos/o/r/pulls',
    ])
    assert.deepEqual(requests[0].body, {
      base_tree: 'parent',
      tree: [{ content: '1.1.0', mode: '100644', path: 'version', type: 'blob' }],
    })
    assert.deepEqual(requests[1].body, { message: DRAFT.title, parents: ['parent'], tree: 'tree' })
    assert.deepEqual(requests[2].body, { ref: 'refs/heads/release/main', sha: 'commit' })
    assert.deepEqual(requests[3].body, { base: 'main', body: 'notes', head: 'release/main', title: DRAFT.title })
    assert.equal(pullRequest.number, 7)
  })

  it('overwrites a branch left behind', async () => {
    const { octokit, requests } = gitHubStub((request) => {
      if (request.path.endsWith('/git/refs')) {
        return { data: { message: 'Reference already exists' }, status: 422 }
      }
      return creatingGitObjects(request) ?? { data: PULL_REQUEST, status: 201 }
    })
    await new GitHubReleasePublisher(octokit, 'o/r', new RecordingReporter()).writePullRequest(DRAFT, undefined)
    const update = requests.find((request) => request.method === 'PATCH')
    assert.equal(update?.path, '/repos/o/r/git/refs/heads%2Frelease%2Fmain')
    assert.deepEqual(update?.body, { force: true, sha: 'commit' })
  })

  it('fails on any other refusal to create the branch', async () => {
    const { octokit } = gitHubStub((request) =>
      request.path.endsWith('/git/refs') ? { data: { message: 'no' }, status: 403 } : creatingGitObjects(request))
    await assert.rejects(new GitHubReleasePublisher(octokit, 'o/r', new RecordingReporter()).writePullRequest(DRAFT, undefined))
  })

  it('updates what is open', async () => {
    const { octokit, requests } = gitHubStub((request) => creatingGitObjects(request) ?? { data: PULL_REQUEST })
    const open = { body: 'old', mergeCommitSha: null, number: 7, url: 'u' }
    const reporter = new RecordingReporter()
    await new GitHubReleasePublisher(octokit, 'o/r', reporter).writePullRequest(DRAFT, open)
    assert.match(reporter.infos[0], /^Updated https:\/\/github\.test\/pull\/7,/)
    assert.deepEqual(requests.slice(2).map((request) => `${request.method} ${request.path}`), [
      'PATCH /repos/o/r/git/refs/heads%2Frelease%2Fmain',
      'PATCH /repos/o/r/pulls/7',
    ])
  })

  it('finds the most recently merged pull request of the release branch', async () => {
    const { octokit, requests } = gitHubStub(() => ({
      data: [
        { ...PULL_REQUEST, merged_at: null, number: 1 },
        { ...PULL_REQUEST, merge_commit_sha: 'old', merged_at: '2026-01-01T00:00:00Z', number: 2 },
        { ...PULL_REQUEST, merge_commit_sha: 'new', merged_at: '2026-02-01T00:00:00Z', number: 3 },
      ],
    }))
    const merged = await new GitHubReleasePublisher(octokit, 'o/r', new RecordingReporter()).findLatestMergedPullRequest('main')
    assert.equal(merged?.number, 3)
    assert.equal(merged?.mergeCommitSha, 'new')
    assert.match(requests[0].path, /head=o%3Arelease%2Fmain/)
    assert.match(requests[0].path, /state=closed/)
  })

  it('finds what is open, and nothing when there is nothing', async () => {
    const empty = gitHubStub(() => ({ data: [] }))
    assert.equal(await new GitHubReleasePublisher(empty.octokit, 'o/r', new RecordingReporter()).findOpenPullRequest('main'), undefined)
    const open = gitHubStub(() => ({ data: [PULL_REQUEST] }))
    assert.equal((await new GitHubReleasePublisher(open.octokit, 'o/r', new RecordingReporter()).findOpenPullRequest('main'))?.number, 7)
  })

  it('creates the release at the merged commit', async () => {
    const { octokit, requests } = gitHubStub(() => ({ data: {}, status: 201 }))
    await new GitHubReleasePublisher(octokit, 'o/r', new RecordingReporter()).createRelease({ body: 'notes', tag: 'v1.1.0', targetSha: 'merged' })
    assert.deepEqual(requests[0].body, { body: 'notes', name: 'v1.1.0', tag_name: 'v1.1.0', target_commitish: 'merged' })
  })

  it('closes the pull request and removes its branch', async () => {
    const { octokit, requests } = gitHubStub((request) => request.method === 'DELETE' ? { status: 204 } : { data: {} })
    const reporter = new RecordingReporter()
    await new GitHubReleasePublisher(octokit, 'o/r', reporter).closePullRequest({ body: '', mergeCommitSha: null, number: 7, url: 'u' }, 'main')
    assert.deepEqual(reporter.infos, ['Closed u, since there is nothing left to release'])
    assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), [
      'PATCH /repos/o/r/pulls/7',
      'DELETE /repos/o/r/git/refs/heads%2Frelease%2Fmain',
    ])
  })
})

describe('GitHubRepositoryReader', () => {
  it('takes a missing file and a missing tag as absent, and any other failure as a failure', async () => {
    const missing = new GitHubRepositoryReader(gitHubStub(() => ({ data: { message: 'x' }, status: 404 })).octokit, 'o/r')
    assert.equal(await missing.fileAt('a', 'ref'), undefined)
    assert.equal(await missing.tagExists('v1'), false)
    const failing = new GitHubRepositoryReader(gitHubStub(() => ({ data: { message: 'x' }, status: 500 })).octokit, 'o/r')
    await assert.rejects(failing.tagExists('v1'))
  })

  it('reads the details of a commit and its merged pull request', async () => {
    const { octokit } = gitHubStub(({ path }) => path.endsWith('/pulls') ?
        {
          data: [
            { body: 'open', merged_at: null, number: 1, title: 'open' },
            { body: 'merged', merged_at: '2026-01-01', number: 2, title: 'merged' },
          ],
        } :
        {
          data: {
            author: { login: 'someone' },
            commit: { message: 'feat: a' },
            files: [{ additions: 1, deletions: 2, filename: 'a.ts', patch: 'p' }, { additions: 0, deletions: 0, filename: 'bin' }],
          },
        })
    assert.deepEqual(await new GitHubRepositoryReader(octokit, 'o/r').commitDetails('sha'), {
      authorLogin: 'someone',
      files: [
        { additions: 1, deletions: 2, patch: 'p', path: 'a.ts' },
        { additions: 0, deletions: 0, patch: '', path: 'bin' },
      ],
      message: 'feat: a',
      pullRequest: { body: 'merged', number: 2, title: 'merged' },
    })
  })

  it('walks every page of a comparison', async () => {
    let page = 0
    const { octokit } = gitHubStub(() => {
      page += 1
      return { data: { commits: [{ commit: { message: `m${page}` }, sha: `s${page}` }], total_commits: 2 } }
    })
    assert.deepEqual(await new GitHubRepositoryReader(octokit, 'o/r').commitsBetween('a', 'b'), [
      { message: 'm1', sha: 's1' },
      { message: 'm2', sha: 's2' },
    ])
  })

  it('recognises a release tag among the tags that start like one', async () => {
    const withTags = (...names: string[]) => new GitHubRepositoryReader(
      gitHubStub(() => ({ data: names.map((name) => ({ ref: `refs/tags/${name}` })) })).octokit,
      'o/r',
    )
    assert.equal(await withTags('v1.2.3').hasReleaseTag(), true)
    assert.equal(await withTags('vendor', 'v1.2.3-rc.1').hasReleaseTag(), false)
    assert.equal(await withTags().hasReleaseTag(), false)
  })

  it('lists only the files of a tree', async () => {
    const { octokit } = gitHubStub(() => ({
      data: { tree: [{ path: 'dir', type: 'tree' }, { path: 'dir/a', type: 'blob' }] },
    }))
    assert.deepEqual(await new GitHubRepositoryReader(octokit, 'o/r').pathsAt('ref'), ['dir/a'])
  })
})
