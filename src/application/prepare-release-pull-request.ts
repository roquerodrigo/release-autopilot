import type { LocalizedNotes } from '../domain/release-notes.ts'
import type { FileChange, ReleasePlan } from '../domain/release-plan.ts'
import type { PatternVersionFile, StructuredVersionFile, VersionFile } from '../domain/version-file.ts'
import type { NotesAuthor, ReleasePlanner, ReleasePublisher, ReleasePullRequest, Reporter, RepositoryReader } from './ports.ts'

import { ReleaseVersionConflictError } from '../domain/errors.ts'
import { changelogWithEntry, pullRequestBodyOf, stateOfPullRequest } from '../domain/release-documents.ts'
import { composedNotes } from '../domain/release-notes.ts'
import { notesFingerprint, pullRequestTitleOf, releaseHeading, tagOf } from '../domain/release-plan.ts'
import { withNewVersion } from '../domain/version-file.ts'
import { releaseBranchOf } from './ports.ts'
import { projectSnapshotAt } from './project-snapshot.ts'
import { collectReleaseSource } from './release-source-collector.ts'
import { VersionFileDetector } from './version-file-detector.ts'

export interface PrepareCollaborators {
  author: NotesAuthor
  clock: () => Date
  planner: ReleasePlanner
  publisher: ReleasePublisher
  reader: RepositoryReader
  reporter: Reporter
}

export class PrepareReleasePullRequest {
  private readonly collaborators: PrepareCollaborators

  constructor(collaborators: PrepareCollaborators) {
    this.collaborators = collaborators
  }

  async run(branch: string): Promise<ReleasePullRequest | undefined> {
    const { author, planner, publisher, reader, reporter } = this.collaborators
    const headSha = await reader.headOf(branch)
    const snapshot = await projectSnapshotAt(reader, headSha)
    const { configuration } = snapshot
    const versionFiles = await new VersionFileDetector(reader).versionFilesAt(headSha, configuration)
    const plan = await planner.plan({
      branch,
      initialVersion: configuration.initialVersion,
      versionFiles: versionFiles.filter(isStructured),
    })
    const open = await publisher.findOpenPullRequest(branch)

    if (!plan) {
      return this.withdraw(open, branch)
    }
    await this.assertVersionIsNew(plan, branch, configuration.initialVersion)

    const fingerprint = notesFingerprint({
      commitShas: plan.commits.map((commit) => commit.sha),
      configuration: snapshot.configurationText,
      hacsManifest: snapshot.hacsManifest,
      version: plan.version,
    })
    if (open && stateOfPullRequest(open.body)?.fingerprint === fingerprint) {
      reporter.info(`${open.url} already carries the notes of these commits`)
      return open
    }

    const source = await collectReleaseSource(reader, plan.commits, configuration)
    const written = await author.write(source, configuration)
    const notes = composedNotes(written, source, configuration)
    if (written.entries.length === 0) {
      return this.withdraw(open, branch)
    }
    const heading = releaseHeading(reader.repository, plan, this.collaborators.clock())
    const support = configuration.supportSection(reader.repository)
    return publisher.writePullRequest({
      base: branch,
      body: pullRequestBodyOf(
        [heading, notes[0].text.trim(), support?.trim()].filter(Boolean).join('\n\n'),
        { fingerprint, version: plan.version },
      ),
      changes: [
        ...plan.fileChanges,
        ...await this.patternChanges(versionFiles, headSha, plan.version),
        ...await this.notesChanges(notes, heading, headSha, plan),
      ],
      head: releaseBranchOf(branch),
      headParentSha: headSha,
      title: pullRequestTitleOf(branch, plan.version),
    }, open)
  }

  private async assertVersionIsNew(plan: ReleasePlan, branch: string, initialVersion: string | undefined): Promise<void> {
    const { reader } = this.collaborators
    const tag = tagOf(plan.version)
    if (await reader.tagExists(tag)) {
      throw new ReleaseVersionConflictError(`the next version of ${branch} is ${plan.version}, but ${tag} already exists, so merging its release would publish nothing`)
    }
    if (!plan.previousTag && !initialVersion && await reader.hasReleaseTag()) {
      throw new ReleaseVersionConflictError(`the repository has release tags, but none among the latest commits of ${branch}, so the version would restart at ${plan.version}: set initial_version to the next one`)
    }
  }

  private async notesChanges(
    notes: readonly LocalizedNotes[],
    heading: string,
    headSha: string,
    plan: ReleasePlan,
  ): Promise<FileChange[]> {
    const { reader } = this.collaborators
    const changes = notes.map(async ({ changelog, text }) => {
      const entry = `${heading}\n\n${text.trim()}\n`
      const cumulative: FileChange[] = changelog.path ?
          [{ content: changelogWithEntry(await reader.fileAt(changelog.path, headSha), entry), path: changelog.path }] :
          []
      const individual: FileChange[] = changelog.releasePath ?
          [{ content: entry, path: changelog.releaseFilePath(plan.version) }] :
          []
      return [...cumulative, ...individual]
    })
    return (await Promise.all(changes)).flat()
  }

  private async patternChanges(files: readonly VersionFile[], headSha: string, version: string): Promise<FileChange[]> {
    const { reader } = this.collaborators
    const changes = files.filter(isPattern).map(async (file) => {
      const content = await reader.fileAt(file.path, headSha) ?? ''
      return { content: withNewVersion(content, file, version), path: file.path }
    })
    return Promise.all(changes)
  }

  private async withdraw(open: ReleasePullRequest | undefined, branch: string): Promise<undefined> {
    const { publisher, reporter } = this.collaborators
    if (open) {
      await publisher.closePullRequest(open, branch)
      reporter.info(`Closed ${open.url}, since there is nothing left to release`)
    }
    return undefined
  }
}

function isPattern(file: VersionFile): file is PatternVersionFile {
  return file.kind === 'pattern'
}

function isStructured(file: VersionFile): file is StructuredVersionFile {
  return file.kind === 'structured'
}
