import { parse as parseYaml, YAMLError } from 'yaml'

import { ChangelogTarget } from './changelog-target.ts'
import { isFilledText, isRecord } from './configuration-values.ts'
import { builtInTextsOf } from './default-texts.ts'
import { InvalidConfigurationError } from './errors.ts'
import { declaredVersionFile, type VersionFile } from './version-file.ts'

export const CONFIGURATION_PATH = '.release-autopilot.yml'
const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md'
const DEFAULT_EFFORT = 'medium'
const DEFAULT_MODEL = 'claude-haiku-5-5'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const KNOWN_FIELDS = new Set([
  'bold_entries',
  'changelogs',
  'effort',
  'initial_version',
  'language',
  'model',
  'priority_paths',
  'prompt',
  'sections',
  'support',
  'title',
  'version_files',
])

export type NotesEffort = typeof EFFORTS[number]

export class ProjectConfiguration {
  readonly boldEntries: boolean
  readonly changelogs: readonly ChangelogTarget[]
  readonly effort: NotesEffort
  readonly initialVersion: string | undefined
  readonly model: string
  readonly priorityPaths: readonly string[]
  readonly prompt: string
  readonly title: boolean
  readonly versionFiles: readonly VersionFile[]
  get languages(): string[] {
    return this.changelogs.map((changelog) => changelog.language)
  }

  get primary(): ChangelogTarget {
    return this.changelogs[0]
  }

  private readonly support: string | undefined

  private constructor(declared: Record<string, unknown>, defaultLanguage: string) {
    this.boldEntries = booleanOf(declared.bold_entries, 'bold_entries')
    this.changelogs = changelogsOf(declared, defaultLanguage)
    this.effort = effortOf(declared.effort)
    this.initialVersion = initialVersionOf(declared.initial_version)
    this.model = modelOf(declared.model)
    this.priorityPaths = textsOf(declared.priority_paths, 'priority_paths')
    this.prompt = promptOf(declared.prompt)
    this.support = supportOf(declared.support, this.primary.language)
    this.title = booleanOf(declared.title, 'title')
    this.versionFiles = listOf(declared.version_files, 'version_files').map(declaredVersionFile)
  }

  static parse(text: string | undefined, defaultLanguage: string): ProjectConfiguration {
    const declared = parsedYaml(text)
    const unknownFields = Object.keys(declared).filter((field) => !KNOWN_FIELDS.has(field)).sort()
    if (unknownFields.length > 0) {
      throw new InvalidConfigurationError(`unknown fields: ${unknownFields.join(', ')}`)
    }
    return new ProjectConfiguration(declared, defaultLanguage)
  }

  isPriority(path: string): boolean {
    return this.priorityPaths.some((priorityPath) => path.startsWith(priorityPath))
  }

  supportSection(repository: string): string | undefined {
    const owner = repository.split('/')[0]
    return this.support?.replaceAll('{url}', `https://github.com/sponsors/${owner}`)
  }
}

export function languageDeclaredBy(hacsManifest: string | undefined): string {
  const country = hacsManifest ? (JSON.parse(hacsManifest) as { country?: unknown }).country : undefined
  const isBrazil = country === 'BR' || (Array.isArray(country) && country.length === 1 && country[0] === 'BR')
  return isBrazil ? 'pt-BR' : 'en'
}

function assertConsistent(primary: ChangelogTarget, translations: ChangelogTarget[]): void {
  if (translations.some((translation) => !translation.path && !translation.releasePath)) {
    throw new InvalidConfigurationError('only the first changelog can leave out both of its paths')
  }
  const changelogs = [primary, ...translations]
  const paths = changelogs.flatMap((changelog) => [changelog.path, changelog.releasePath]).filter(Boolean)
  const languages = changelogs.map((changelog) => changelog.language)
  if (new Set(paths).size !== paths.length || new Set(languages).size !== languages.length) {
    throw new InvalidConfigurationError('each changelog needs its own language and path')
  }
  const sectionsOf = (changelog: ChangelogTarget) => Object.keys(changelog.sectionTitles).sort().join()
  if (translations.some((translation) => sectionsOf(translation) !== sectionsOf(primary))) {
    throw new InvalidConfigurationError('every changelog must have the same sections')
  }
}

function booleanOf(value: unknown, name: string): boolean {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new InvalidConfigurationError(`${name} is not true or false`)
  }
  return value ?? false
}

function changelogsOf(declared: Record<string, unknown>, defaultLanguage: string): ChangelogTarget[] {
  const entries = declared.changelogs === undefined ?
      [{ language: declared.language ?? defaultLanguage, sections: declared.sections }] :
      declaredChangelogs(declared)
  const [primary, ...translations] = entries.map((entry) => ChangelogTarget.declaredBy(entry))
  assertConsistent(primary, translations)
  return [primary.withPathWhenMissing(DEFAULT_CHANGELOG_PATH), ...translations]
}

function declaredChangelogs(declared: Record<string, unknown>): unknown[] {
  if (declared.language !== undefined || declared.sections !== undefined) {
    throw new InvalidConfigurationError('language and sections belong inside each changelog')
  }
  const entries = listOf(declared.changelogs, 'changelogs')
  if (entries.length === 0) {
    throw new InvalidConfigurationError('changelogs is empty')
  }
  return entries
}

function documentOf(text: string): unknown {
  try {
    return parseYaml(text)
  } catch (error) {
    if (error instanceof YAMLError) {
      throw new InvalidConfigurationError(`${CONFIGURATION_PATH} is not valid YAML: ${error.message}`)
    }
    throw error
  }
}

function effortOf(value: unknown): NotesEffort {
  const effort = EFFORTS.find((known) => known === (value ?? DEFAULT_EFFORT))
  if (!effort) {
    throw new InvalidConfigurationError(`effort must be one of: ${EFFORTS.join(', ')}`)
  }
  return effort
}

function initialVersionOf(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new InvalidConfigurationError('initial_version is not a version')
  }
  return value
}

function listOf(value: unknown, name: string): unknown[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(`${name} is not a list`)
  }
  return value
}

function modelOf(value: unknown): string {
  if (value !== undefined && !isFilledText(value)) {
    throw new InvalidConfigurationError('model is not text')
  }
  return value ?? DEFAULT_MODEL
}

function parsedYaml(text: string | undefined): Record<string, unknown> {
  const document = text ? documentOf(text) : null
  if (document === null) {
    return {}
  }
  if (!isRecord(document)) {
    throw new InvalidConfigurationError(`${CONFIGURATION_PATH} is not a map of fields`)
  }
  return document
}

function promptOf(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new InvalidConfigurationError('prompt is not text')
  }
  return (value ?? '').trim()
}

function supportOf(declared: unknown, language: string): string | undefined {
  if (declared === false) {
    return undefined
  }
  if (declared !== undefined && declared !== true && !isFilledText(declared)) {
    throw new InvalidConfigurationError('support is not true, false or a text')
  }
  const text = typeof declared === 'string' ? declared : builtInTextsOf(language)?.support
  if (text === undefined) {
    throw new InvalidConfigurationError(`${language} has no built-in support section, so support must be a text or false`)
  }
  return text
}

function textsOf(value: unknown, name: string): string[] {
  const texts = listOf(value, name)
  if (!texts.every(isFilledText)) {
    throw new InvalidConfigurationError(`${name} is not a list of text`)
  }
  return texts
}
