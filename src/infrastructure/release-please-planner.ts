import type { BuildNotesOptions, Commit, ConventionalCommit, PluginBuilder, ReleaserConfig } from 'release-please'

import releasePlease from 'release-please'

import type { ReleasePlanner, ReleasePlanRequest, Reporter } from '../application/ports.ts'
import type { FileChange, PlannedCommit, ReleasePlan } from '../domain/release-plan.ts'

const { Errors, GitHub, Manifest, registerChangelogNotes, registerPlugin, setLogger } = releasePlease
interface FileUpdate {
  path: string
  updater: { updateContent(content: string | undefined): string }
}

type GitHubClient = Awaited<ReturnType<typeof GitHub.create>>

const COMMIT_CAPTURE = 'commit-capture'
const UNWRITTEN_MANIFEST = '.release-please-manifest.json'
const ABSENT_VERSION = '9999.9999.9999'

class CommitCapture {
  previousTag: string | undefined
  get commits(): PlannedCommit[] {
    return this.rawCommits.map(({ sha }) => ({ isBreaking: this.breakingShas.has(sha), sha }))
  }

  private breakingShas = new Set<string>()

  private rawCommits: Commit[] = []

  async buildNotes(parsedCommits: ConventionalCommit[], options: BuildNotesOptions): Promise<string> {
    this.previousTag = options.previousTag
    this.breakingShas = new Set(parsedCommits.filter((commit) => commit.breaking).map((commit) => commit.sha))
    // The engine takes a result of a single line as nothing worth a release.
    return `${options.version}\n\nplanned`
  }

  // The engine parses commits before writing notes: it drops the ones that are not
  // conventional and repeats the ones with footers, so only this hook sees them as they are.
  async preconfigure<Strategies>(strategies: Strategies, commitsByPath: Record<string, Commit[]>): Promise<Strategies> {
    this.rawCommits = Object.values(commitsByPath).flat()
    return strategies
  }

  processCommits(commits: ConventionalCommit[]): ConventionalCommit[] {
    return commits
  }

  async run<PullRequests>(pullRequests: PullRequests): Promise<PullRequests> {
    return pullRequests
  }
}

export class ReleasePleasePlanner implements ReleasePlanner {
  private readonly fetchImplementation: typeof fetch | undefined
  private readonly repository: string
  private readonly token: string

  constructor(repository: string, token: string, reporter: Reporter, fetchImplementation?: typeof fetch) {
    this.repository = repository
    this.token = token
    this.fetchImplementation = fetchImplementation
    const log = (message: unknown) => reporter.info(`engine: ${String(message)}`)
    setLogger({ debug() {}, error: log, info() {}, trace() {}, warn() {} })
  }

  async plan(request: ReleasePlanRequest): Promise<ReleasePlan | undefined> {
    const [owner, repo] = this.repository.split('/')
    const capture = new CommitCapture()
    registerChangelogNotes(COMMIT_CAPTURE, () => capture)
    registerPlugin(COMMIT_CAPTURE, () => capture as unknown as ReturnType<PluginBuilder>)
    const github = await GitHub.create({ fetch: this.fetchImplementation, owner, repo, token: this.token })
    const manifest = await Manifest.fromConfig(github, request.branch, releaserConfig(repo, request), { plugins: [COMMIT_CAPTURE] })
    const [candidate] = await manifest.buildPullRequests()
    if (!candidate?.version) {
      return undefined
    }
    return {
      commits: capture.commits,
      fileChanges: await fileChanges(github, request.branch, candidate),
      previousTag: capture.previousTag,
      version: candidate.version.toString(),
    }
  }
}

async function currentContent(github: GitHubClient, branch: string, path: string): Promise<string | undefined> {
  try {
    return (await github.getFileContentsOnBranch(path, branch)).parsedContent
  } catch (error) {
    if (error instanceof Errors.FileNotFoundError) {
      return undefined
    }
    throw error
  }
}

async function fileChange(
  github: GitHubClient,
  branch: string,
  update: FileUpdate,
  version: string,
): Promise<FileChange | undefined> {
  const current = await currentContent(github, branch, update.path)
  if (current === undefined) {
    return undefined
  }
  if (!takesVersion(update, current, version)) {
    throw new Error(`${update.path} did not take the version ${version}, so its selector matches nothing`)
  }
  return { content: update.updater.updateContent(current), path: update.path }
}

async function fileChanges(
  github: GitHubClient,
  branch: string,
  candidate: { updates: readonly FileUpdate[], version?: { toString(): string } },
): Promise<FileChange[]> {
  const version = candidate.version!.toString()
  const updates = candidate.updates.filter((update) => update.path !== UNWRITTEN_MANIFEST)
  const changes = await Promise.all(updates.map((update) => fileChange(github, branch, update, version)))
  return changes.filter((change) => change !== undefined)
}

function releaserConfig(packageName: string, request: ReleasePlanRequest): ReleaserConfig {
  return {
    bumpMinorPreMajor: true,
    bumpPatchForMinorPreMajor: true,
    changelogType: COMMIT_CAPTURE,
    extraFiles: request.versionFiles.map((file) => ({
      jsonpath: file.jsonPath,
      path: file.path,
      type: file.format,
    })),
    includeComponentInTag: false,
    includeVInTag: true,
    initialVersion: request.initialVersion,
    packageName,
    releaseType: 'simple',
    skipChangelog: true,
  }
}

// The version can already be in the file, as a current value or as that of a dependency,
// so it only counts when it comes back after being taken out of the file.
function takesVersion(update: FileUpdate, current: string, version: string): boolean {
  return update.updater.updateContent(current.replaceAll(version, ABSENT_VERSION)).includes(version)
}
