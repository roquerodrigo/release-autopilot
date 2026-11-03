export interface FakeCommit {
  message: string
  sha: string
}

export interface FakePullRequest {
  body: string
  head: string
  html_url: string
  merge_commit_sha: null | string
  merged_at: null | string
  number: number
  state: 'closed' | 'open'
  title: string
}

export interface FakeRelease {
  sha: string
  tag: string
}

export interface FakeRepository {
  commits: readonly FakeCommit[]
  files?: Record<string, string>
  pullRequests?: FakePullRequest[]
  releases?: FakeRelease[]
  tags?: readonly FakeRelease[]
}

export interface RecordedWrite {
  body: Record<string, unknown>
  method: string
  path: string
}

interface Answer {
  data?: unknown
  status?: number
  text?: string
}

const BLOB_PREFIX = 'blob-'
const NOT_FOUND: Answer = { data: { message: 'Not Found' }, status: 404 }

export function fakeGitHub(repository: FakeRepository, writes: RecordedWrite[] = []): typeof fetch {
  return async (input, init) => {
    const { pathname, searchParams } = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    const path = pathname.split('/').slice(4).join('/')
    const answer = pathname === '/graphql' ?
        { data: { data: answerToQuery(repository, String(body.query)) } } :
      method === 'GET' ?
          answerToRead(repository, path, searchParams) :
          answerToWrite(repository, path, body)
    if (pathname !== '/graphql' && method !== 'GET') {
      writes.push({ body, method, path })
    }
    const { data, status = 200, text } = answer
    return new Response(text ?? JSON.stringify(data), {
      headers: { 'content-type': text === undefined ? 'application/json' : 'text/plain' },
      status,
    })
  }
}

function allReleaseTags(repository: FakeRepository): FakeRelease[] {
  return [...repository.releases ?? [], ...repository.tags ?? []]
}

function answerToCommit(repository: FakeRepository, sha: string): Answer {
  const message = repository.commits.find((commit) => commit.sha === sha)?.message ?? 'feat: x'
  return {
    data: {
      author: { login: 'someone' },
      commit: { message },
      files: [{ additions: 1, deletions: 0, filename: 'src/a.ts', patch: '+a' }],
      parents: [{ sha: 'parent' }],
    },
  }
}

function answerToQuery(repository: FakeRepository, query: string): unknown {
  const pageInfo = { endCursor: null, hasNextPage: false }
  if (query.includes('releases(')) {
    const nodes = (repository.releases ?? []).map(({ sha, tag }) => ({
      description: '',
      isDraft: false,
      name: tag,
      tag: { name: tag },
      tagCommit: { oid: sha },
      url: `https://github.test/${tag}`,
    }))
    return { repository: { releases: { nodes, pageInfo } } }
  }
  const nodes = repository.commits.map(({ message, sha }) => ({
    associatedPullRequests: { nodes: [] },
    author: null,
    message,
    sha,
  }))
  return { repository: { ref: { target: { history: { nodes, pageInfo } } } } }
}

function answerToRead(repository: FakeRepository, path: string, query: URLSearchParams): Answer {
  const files = repository.files ?? {}
  if (path === '') {
    return { data: { default_branch: 'main' } }
  }
  if (path === 'tags') {
    return { data: (repository.tags ?? []).map(({ sha, tag }) => ({ commit: { sha }, name: tag })) }
  }
  if (path.startsWith('branches/')) {
    return { data: { commit: { sha: repository.commits[0].sha } } }
  }
  if (path.startsWith('compare/')) {
    const commits = repository.commits.map(({ message, sha }) => ({ commit: { message }, sha }))
    return { data: { commits, total_commits: commits.length } }
  }
  if (path.endsWith('/pulls') && path.startsWith('commits/')) {
    return { data: [] }
  }
  if (path.startsWith('commits/')) {
    return answerToCommit(repository, path.slice('commits/'.length))
  }
  if (path.startsWith('contents/')) {
    const content = files[decodeURIComponent(path.slice('contents/'.length))]
    return content === undefined ? NOT_FOUND : { text: content }
  }
  if (path.startsWith('git/matching-refs/')) {
    return { data: allReleaseTags(repository).map(({ tag }) => ({ ref: `refs/tags/${tag}` })) }
  }
  if (path.startsWith('git/ref/')) {
    const tag = decodeURIComponent(path.slice('git/ref/'.length)).replace('tags/', '')
    return allReleaseTags(repository).some((release) => release.tag === tag) ? { data: { ref: `refs/tags/${tag}` } } : NOT_FOUND
  }
  if (path.startsWith('git/trees/')) {
    const tree = Object.keys(files).map((file, index) => ({ mode: '100644', path: file, sha: `${BLOB_PREFIX}${index}`, type: 'blob' }))
    return { data: { tree, truncated: false } }
  }
  if (path.startsWith('git/blobs/')) {
    const index = Number(path.slice('git/blobs/'.length + BLOB_PREFIX.length))
    return { data: { content: Buffer.from(Object.values(files)[index]).toString('base64') } }
  }
  if (path === 'pulls') {
    return { data: (repository.pullRequests ?? []).filter(({ state }) => state === query.get('state')) }
  }
  return NOT_FOUND
}

function answerToWrite(repository: FakeRepository, path: string, body: Record<string, unknown>): Answer {
  if (path === 'releases') {
    repository.releases = [...repository.releases ?? [], { sha: String(body.target_commitish), tag: String(body.tag_name) }]
    return { data: {}, status: 201 }
  }
  if (path === 'pulls') {
    return {
      data: { body: body.body, html_url: 'https://github.test/pull/7', merge_commit_sha: null, number: 7 },
      status: 201,
    }
  }
  return { data: { sha: `created-${path}` }, status: 201 }
}
