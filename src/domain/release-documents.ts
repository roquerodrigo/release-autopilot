const CHANGELOG_TITLE = '# Changelog'
const FIRST_RELEASE_HEADING = /^##? /m
const MARKER = /\n*<!-- release-autopilot: (?<state>\{.*\}) -->\s*$/

export interface ReleasePullRequestState {
  fingerprint: string
  version: string
}

export function changelogWithEntry(current: string | undefined, entry: string): string {
  const trimmedEntry = `${entry.trim()}\n`
  if (!current) {
    return `${CHANGELOG_TITLE}\n\n${trimmedEntry}`
  }
  const withoutTitle = current.replace(/^# .*\n+/, '')
  const title = current.slice(0, current.length - withoutTitle.length)
  const firstRelease = withoutTitle.search(FIRST_RELEASE_HEADING)
  const position = title.length + (firstRelease === -1 ? withoutTitle.length : firstRelease)
  const before = current.slice(0, position)
  const after = current.slice(position)
  const separator = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  return `${before}${separator}${trimmedEntry}${after ? `\n${after}` : ''}`
}

export function notesOfPullRequest(body: string): string {
  return `${body.replace(MARKER, '').trim()}\n`
}

export function pullRequestBodyOf(notes: string, state: ReleasePullRequestState): string {
  return `${notes.trim()}\n\n<!-- release-autopilot: ${JSON.stringify(state)} -->\n`
}

export function stateOfPullRequest(body: null | string | undefined): ReleasePullRequestState | undefined {
  const marker = body ? MARKER.exec(body)?.groups?.state : undefined
  return marker ? JSON.parse(marker) as ReleasePullRequestState : undefined
}
