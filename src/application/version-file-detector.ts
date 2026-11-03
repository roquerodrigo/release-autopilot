import { parse as parseToml } from 'smol-toml'

import type { ProjectConfiguration } from '../domain/project-configuration.ts'
import type { VersionFile } from '../domain/version-file.ts'
import type { RepositoryReader } from './ports.ts'

import { InvalidConfigurationError } from '../domain/errors.ts'

const HOME_ASSISTANT_MANIFEST = /^custom_components\/[^/]+\/manifest\.json$/

interface PythonProject {
  project?: {
    dynamic?: string[]
    name?: string
    version?: string
  }
}

export class VersionFileDetector {
  private readonly reader: RepositoryReader

  constructor(reader: RepositoryReader) {
    this.reader = reader
  }

  async versionFilesAt(ref: string, configuration: ProjectConfiguration): Promise<VersionFile[]> {
    const paths = new Set(await this.reader.pathsAt(ref))
    const detected: VersionFile[] = [
      ...[...paths].filter((path) => HOME_ASSISTANT_MANIFEST.test(path)).map((path) => structuredJson(path, '$.version')),
      ...await this.pythonFiles(paths, ref),
      ...await this.nodeFiles(paths, ref),
    ]
    const declaredPaths = new Set(configuration.versionFiles.map((file) => file.path))
    const missing = [...declaredPaths].filter((path) => !paths.has(path))
    if (missing.length > 0) {
      throw new InvalidConfigurationError(`version files that do not exist: ${missing.join(', ')}`)
    }
    return [...detected.filter((file) => !declaredPaths.has(file.path)), ...configuration.versionFiles]
  }

  private async nodeFiles(paths: Set<string>, ref: string): Promise<VersionFile[]> {
    if (!paths.has('package.json')) {
      return []
    }
    const manifest = JSON.parse(await this.reader.fileAt('package.json', ref) ?? '{}') as { version?: string }
    if (!manifest.version) {
      return []
    }
    const lockFiles = paths.has('package-lock.json') ?
        [structuredJson('package-lock.json', '$.version'), structuredJson('package-lock.json', '$.packages[\'\'].version')] :
        []
    return [structuredJson('package.json', '$.version'), ...lockFiles]
  }

  private async pythonFiles(paths: Set<string>, ref: string): Promise<VersionFile[]> {
    if (!paths.has('pyproject.toml')) {
      return []
    }
    const { project } = parseToml(await this.reader.fileAt('pyproject.toml', ref) ?? '') as PythonProject
    if (!project?.version || project.dynamic?.includes('version')) {
      return []
    }
    const lockedName = project.name?.toLowerCase().replaceAll(/[-_.]+/g, '-')
    const lockFile = paths.has('uv.lock') && lockedName ?
        [structuredToml('uv.lock', `$.package[?(@.name.value=="${lockedName}")].version`)] :
        []
    return [structuredToml('pyproject.toml', '$.project.version'), ...lockFile]
  }
}

function structuredJson(path: string, jsonPath: string): VersionFile {
  return { format: 'json', jsonPath, kind: 'structured', path }
}

function structuredToml(path: string, jsonPath: string): VersionFile {
  return { format: 'toml', jsonPath, kind: 'structured', path }
}
