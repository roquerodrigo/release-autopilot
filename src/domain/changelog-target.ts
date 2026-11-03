import { isFilledText, isRecord } from './configuration-values.ts'
import { BREAKING_SECTION, builtInTextsOf } from './default-texts.ts'
import { InvalidConfigurationError } from './errors.ts'

const KNOWN_FIELDS = new Set(['language', 'path', 'release_path', 'sections'])
const RELEASE_PATH_VERSION = '{version}'

export class ChangelogTarget {
  readonly language: string
  readonly path: string
  readonly releasePath: string
  readonly sectionTitles: Record<string, string>

  private constructor(fields: {
    language: string
    path: string
    releasePath: string
    sectionTitles: Record<string, string>
  }) {
    this.language = fields.language
    this.path = fields.path
    this.releasePath = fields.releasePath
    this.sectionTitles = fields.sectionTitles
  }

  static declaredBy(declared: unknown): ChangelogTarget {
    if (!isRecord(declared)) {
      throw new InvalidConfigurationError('a changelog is not a table')
    }
    const unknownFields = Object.keys(declared).filter((field) => !KNOWN_FIELDS.has(field)).sort()
    if (unknownFields.length > 0) {
      throw new InvalidConfigurationError(`unknown changelog fields: ${unknownFields.join(', ')}`)
    }
    const language = languageTagOf(declared.language)
    return new ChangelogTarget({
      language,
      path: relativePathOf(declared.path ?? ''),
      releasePath: releasePathOf(declared.release_path ?? ''),
      sectionTitles: sectionTitlesOf(declared.sections ?? {}, language),
    })
  }

  releaseFilePath(version: string): string {
    return this.releasePath.replaceAll(RELEASE_PATH_VERSION, version)
  }

  withPathWhenMissing(path: string): ChangelogTarget {
    return this.path ? this : new ChangelogTarget({ ...this, path })
  }
}

function canonicalTagOf(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0]
  } catch {
    return undefined
  }
}

function languageTagOf(declared: unknown): string {
  const language = typeof declared === 'string' ? canonicalTagOf(declared) : undefined
  if (!language) {
    throw new InvalidConfigurationError('language is not a language tag')
  }
  return language
}

function relativePathOf(path: unknown): string {
  if (typeof path !== 'string') {
    throw new InvalidConfigurationError('path is not text')
  }
  if (path.startsWith('/') || path.split('/').includes('..')) {
    throw new InvalidConfigurationError(`${path} is outside the repository`)
  }
  return path
}

function releasePathOf(declared: unknown): string {
  const path = relativePathOf(declared)
  if (path && !path.includes(RELEASE_PATH_VERSION)) {
    throw new InvalidConfigurationError(`release_path needs ${RELEASE_PATH_VERSION}, or every release overwrites the last`)
  }
  return path
}

function sectionTitlesOf(declared: unknown, language: string): Record<string, string> {
  if (!isRecord(declared) || !Object.values(declared).every(isFilledText)) {
    throw new InvalidConfigurationError('sections does not map each section to its title')
  }
  const titles = declared as Record<string, string>
  const defaults = builtInTextsOf(language)?.sections
  if (Object.keys(titles).length === 0) {
    if (!defaults) {
      throw new InvalidConfigurationError(`${language} has no built-in sections, so it must declare them`)
    }
    return { [BREAKING_SECTION]: defaults[BREAKING_SECTION], ...defaults }
  }
  const breakingTitle = titles[BREAKING_SECTION] ?? defaults?.[BREAKING_SECTION]
  if (!breakingTitle) {
    throw new InvalidConfigurationError(`${language} has no built-in title for the breaking section`)
  }
  return { [BREAKING_SECTION]: breakingTitle, ...titles }
}
