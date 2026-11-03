import type { RepositoryReader } from './ports.ts'

import { CONFIGURATION_PATH, languageDeclaredBy, ProjectConfiguration } from '../domain/project-configuration.ts'

export interface ProjectSnapshot {
  configuration: ProjectConfiguration
  configurationText: string | undefined
  hacsManifest: string | undefined
}

export async function projectSnapshotAt(reader: RepositoryReader, ref: string): Promise<ProjectSnapshot> {
  const [configurationText, hacsManifest] = await Promise.all([
    reader.fileAt(CONFIGURATION_PATH, ref),
    reader.fileAt('hacs.json', ref),
  ])
  return {
    configuration: ProjectConfiguration.parse(configurationText, languageDeclaredBy(hacsManifest)),
    configurationText,
    hacsManifest,
  }
}
