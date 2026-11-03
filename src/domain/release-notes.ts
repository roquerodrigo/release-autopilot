import type { ChangelogTarget } from './changelog-target.ts'
import type { ProjectConfiguration } from './project-configuration.ts'
import type { ReleaseSource } from './release-source.ts'

import { BREAKING_SECTION } from './default-texts.ts'
import { RejectedNotesError } from './errors.ts'
import { hasBreakingCommit, knownPullRequests } from './release-source.ts'

const BOLD_MARK = '**'
const FORBIDDEN_MARKUP = /https?:\/\/|!\[|\]\(|<\s*\/?\s*(details|summary)/i
const MENTION = /(?<![\w.`])@[\w-]+(?:\/[\w.-]+)?/g

export interface LocalizedNotes {
  changelog: ChangelogTarget
  text: string
}

export interface WrittenEntry {
  category: string
  pull_requests: readonly number[]
  text: Record<string, string>
}

export interface WrittenNotes {
  entries: readonly WrittenEntry[]
  summary: Record<string, string>
  title?: Record<string, string>
}

export function composedNotes(
  written: WrittenNotes,
  source: ReleaseSource,
  configuration: ProjectConfiguration,
): LocalizedNotes[] {
  return configuration.changelogs.map((changelog) => ({
    changelog,
    text: renderedNotes(written, source, configuration, changelog),
  }))
}

function bullet(text: string, pullRequests: readonly number[], repository: string): string {
  if (pullRequests.length === 0) {
    return `- ${text}`
  }
  const links = pullRequests.map((number) => `[#${number}](https://github.com/${repository}/pull/${number})`)
  return `- ${text} (${links.join(', ')})`
}

function publishableLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ').replace(MENTION, '`$&`')
}

function renderedNotes(
  written: WrittenNotes,
  source: ReleaseSource,
  configuration: ProjectConfiguration,
  changelog: ChangelogTarget,
): string {
  const language = changelog.language
  const title = publishableLine(written.title?.[language] ?? '')
  const summary = publishableLine(written.summary[language] ?? '')
  const known = knownPullRequests(source)
  const entries = written.entries.map((entry) => ({
    category: entry.category,
    pullRequests: entry.pull_requests.filter((number) => known.has(number)),
    text: publishableLine(entry.text[language] ?? ''),
  }))

  if (entries.some((entry) => !entry.text || !(entry.category in changelog.sectionTitles))) {
    throw new RejectedNotesError('an entry is empty or has an unknown category')
  }
  const forbidden = [title, summary, ...entries.map((entry) => entry.text)]
    .map((text) => FORBIDDEN_MARKUP.exec(text)?.[0])
    .find(Boolean)
  if (forbidden) {
    throw new RejectedNotesError(`the text carries a link, an image or HTML: ${forbidden}`)
  }
  if (configuration.title && entries.length > 0 && !title) {
    throw new RejectedNotesError('a release with entries has no title')
  }
  if (title.includes(BOLD_MARK)) {
    throw new RejectedNotesError('the title carries bold of its own')
  }
  if (configuration.boldEntries && entries.some((entry) => entry.text.split(BOLD_MARK).length % 2 === 0)) {
    throw new RejectedNotesError('an entry leaves its bold open')
  }
  if (hasBreakingCommit(source) && !entries.some((entry) => entry.category === BREAKING_SECTION)) {
    throw new RejectedNotesError('a breaking commit has no breaking entry')
  }

  const sections = Object.entries(changelog.sectionTitles).flatMap(([category, sectionTitle]) => {
    const bullets = entries
      .filter((entry) => entry.category === category)
      .map((entry) => bullet(entry.text, entry.pullRequests, source.repository))
    return bullets.length > 0 ? [`### ${sectionTitle}\n\n${bullets.join('\n')}`] : []
  })
  const blocks = [title && `${BOLD_MARK}${title}${BOLD_MARK}`, summary, ...sections].filter(Boolean)
  return `${blocks.join('\n\n')}\n`
}
