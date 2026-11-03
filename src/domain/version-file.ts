import { isFilledText, isRecord } from './configuration-values.ts'
import { InvalidConfigurationError } from './errors.ts'

export interface PatternVersionFile {
  kind: 'pattern'
  path: string
  pattern: string
}

export type StructuredFormat = 'json' | 'toml' | 'yaml'

export interface StructuredVersionFile {
  format: StructuredFormat
  jsonPath: string
  kind: 'structured'
  path: string
}

export type VersionFile = PatternVersionFile | StructuredVersionFile

const FORMAT_BY_EXTENSION: Record<string, StructuredFormat> = {
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
}

export function declaredVersionFile(declared: unknown): VersionFile {
  if (!isRecord(declared) || !isFilledText(declared.path)) {
    throw new InvalidConfigurationError('a version file has no path')
  }
  const { json_path: jsonPath, path, pattern } = declared
  if (isFilledText(jsonPath) === isFilledText(pattern)) {
    throw new InvalidConfigurationError(`${path} needs either json_path or pattern`)
  }
  if (isFilledText(pattern)) {
    return { kind: 'pattern', path, pattern: validatedPattern(pattern, path) }
  }
  const format = FORMAT_BY_EXTENSION[path.split('.').at(-1) ?? '']
  if (!format) {
    throw new InvalidConfigurationError(`${path} is not JSON, TOML or YAML, so it needs a pattern`)
  }
  return { format, jsonPath: jsonPath as string, kind: 'structured', path }
}

export function withNewVersion(content: string, file: PatternVersionFile, version: string): string {
  const captured = new RegExp(file.pattern, 'dm').exec(content)?.indices?.[1]
  if (!captured) {
    throw new InvalidConfigurationError(`the pattern of ${file.path} matches nothing`)
  }
  const [start, end] = captured
  return `${content.slice(0, start)}${version}${content.slice(end)}`
}

function validatedPattern(pattern: string, path: string): string {
  let captureGroups: number
  try {
    captureGroups = new RegExp(`${pattern}|`).exec('')!.length - 1
  } catch {
    throw new InvalidConfigurationError(`the pattern of ${path} is not a regular expression`)
  }
  if (captureGroups !== 1) {
    throw new InvalidConfigurationError(`the pattern of ${path} needs one capture group around the version`)
  }
  return pattern
}
