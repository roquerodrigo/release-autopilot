import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isBreakingCommit } from '../src/domain/conventional-commit.ts'
import { InvalidConfigurationError, RejectedNotesError } from '../src/domain/errors.ts'
import { languageDeclaredBy, ProjectConfiguration } from '../src/domain/project-configuration.ts'
import { changelogWithEntry, notesOfPullRequest, pullRequestBodyOf, stateOfPullRequest } from '../src/domain/release-documents.ts'
import { composedNotes } from '../src/domain/release-notes.ts'
import { notesFingerprint, releaseHeading } from '../src/domain/release-plan.ts'
import { releaseCommitOf, type ReleaseSource } from '../src/domain/release-source.ts'
import { declaredVersionFile, withNewVersion } from '../src/domain/version-file.ts'
import { writtenEntry, writtenNotes } from './support.ts'

const english = (yaml?: string) => ProjectConfiguration.parse(yaml, 'en')
const invalid = (yaml: string) => assert.throws(() => english(yaml), InvalidConfigurationError)
const sourceOf = (...commits: Partial<ReleaseSource['commits'][number]>[]): ReleaseSource => ({
  commits: commits.map((commit) => ({
    files: [],
    is_breaking: false,
    message: 'feat: x',
    pull_request_description: '',
    pull_request_number: null,
    pull_request_title: '',
    ...commit,
  })),
  repository: 'owner/project',
})

describe('isBreakingCommit', () => {
  it('takes the mark and the footer as breaking', () => {
    assert.equal(isBreakingCommit('feat!: x'), true)
    assert.equal(isBreakingCommit('feat(sensor)!: x'), true)
    assert.equal(isBreakingCommit('fix: x\n\nBREAKING CHANGE: y'), true)
    assert.equal(isBreakingCommit('fix: x\n\nBREAKING-CHANGE: y'), true)
    assert.equal(isBreakingCommit('fix: x\n\nBREAKING CHANGE #12 removes it'), true)
  })

  it('takes anything else as not breaking', () => {
    assert.equal(isBreakingCommit('feat(sensor): add'), false)
    assert.equal(isBreakingCommit('update things'), false)
  })
})

describe('ProjectConfiguration', () => {
  it('needs no file at all', () => {
    const configuration = english()
    assert.deepEqual(configuration.languages, ['en'])
    assert.equal(configuration.primary.path, 'CHANGELOG.md')
    assert.equal(configuration.title, false)
  })

  it('takes an empty file as no file', () => {
    assert.deepEqual(english('# nothing yet\n').languages, ['en'])
  })

  it('takes the language from the Brazilian HACS manifest', () => {
    assert.equal(languageDeclaredBy('{"country": ["BR"]}'), 'pt-BR')
    assert.equal(languageDeclaredBy('{"country": "BR"}'), 'pt-BR')
    assert.equal(languageDeclaredBy('{"country": ["BR", "PT"]}'), 'en')
    assert.equal(languageDeclaredBy(undefined), 'en')
  })

  it('lets a declared language win', () => {
    assert.equal(ProjectConfiguration.parse('language: en', 'pt-BR').primary.language, 'en')
  })

  it('reads the options of the notes', () => {
    const configuration = english(`
prompt: |
  Write patch notes.
title: true
bold_entries: true
priority_paths: [src/data/]
initial_version: 0.1.0
`)
    assert.equal(configuration.prompt, 'Write patch notes.')
    assert.equal(configuration.title, true)
    assert.equal(configuration.boldEntries, true)
    assert.equal(configuration.isPriority('src/data/a.json'), true)
    assert.equal(configuration.isPriority('src/other.json'), false)
    assert.equal(configuration.initialVersion, '0.1.0')
  })

  it('writes with the default model and effort unless told otherwise', () => {
    assert.equal(english().model, 'claude-haiku-5-5')
    assert.equal(english().effort, 'medium')
    const configuration = english('model: claude-opus-5-5\neffort: high\n')
    assert.equal(configuration.model, 'claude-opus-5-5')
    assert.equal(configuration.effort, 'high')
  })

  it('always keeps the breaking section, first', () => {
    assert.deepEqual(Object.keys(english().primary.sectionTitles), ['breaking', 'added', 'changed', 'fixed'])
    const configuration = english('sections:\n  balance: Balance\n')
    assert.deepEqual(Object.keys(configuration.primary.sectionTitles), ['breaking', 'balance'])
  })

  it('writes each language tag in its canonical form', () => {
    assert.equal(english('changelogs:\n  - language: PT-br\n').primary.language, 'pt-BR')
    invalid('changelogs:\n  - language: en\n  - language: EN\n    path: b.md\n')
  })

  it('reads several changelogs and fills in the path of the first', () => {
    const configuration = english(`
changelogs:
  - language: pt-BR
  - language: en
    release_path: docs/{version}.md
`)
    assert.equal(configuration.changelogs[0].path, 'CHANGELOG.md')
    assert.equal(configuration.changelogs[1].path, '')
    assert.equal(configuration.changelogs[1].releaseFilePath('1.2.3'), 'docs/1.2.3.md')
  })

  it('needs the texts of a language it does not know', () => {
    const spanish = 'changelogs:\n  - language: es\n    sections:\n      breaking: Rotura\n      added: Novedades\n'
    invalid('changelogs:\n  - language: es\n')
    invalid(spanish)
    assert.equal(english(`support: false\n${spanish}`).supportSection('owner/project'), undefined)
    assert.equal(english(`support: Apoya en {url}\n${spanish}`).supportSection('owner/project'), 'Apoya en https://github.com/sponsors/owner')
  })

  it('invites sponsorship unless told otherwise', () => {
    assert.match(english().supportSection('owner/project')!, /### Support[\s\S]*\(https:\/\/github\.com\/sponsors\/owner\)/)
    assert.match(english('support: true').supportSection('owner/project')!, /### Support/)
    assert.match(ProjectConfiguration.parse(undefined, 'pt-BR').supportSection('owner/project')!, /### Apoio/)
    assert.equal(english('support: false').supportSection('owner/project'), undefined)
    assert.equal(english('support: Pay at {url}').supportSection('owner/project'), 'Pay at https://github.com/sponsors/owner')
  })

  it('takes the support section of the first language only', () => {
    const configuration = english('changelogs:\n  - language: pt-BR\n  - language: es\n    path: es.md\n    sections:\n      breaking: Rotura\n      added: Novedades\n      changed: Mejoras\n      fixed: Correcciones\n')
    assert.match(configuration.supportSection('owner/project')!, /### Apoio/)
  })

  it('reads the version files', () => {
    const configuration = english(`
version_files:
  - path: src/manifest.json
    json_path: $.version
  - path: SKILL.md
    pattern: '^version: (\\S+)'
`)
    assert.deepEqual(configuration.versionFiles.map((file) => file.kind), ['structured', 'pattern'])
  })

  it('refuses what it cannot use', () => {
    invalid('unknown: 1')
    invalid('shown_commit_types: [feat]')
    invalid('a: [')
    invalid('just text')
    invalid('- a list')
    invalid('language: xx')
    invalid('title: yes please')
    invalid('prompt: 3')
    invalid('priority_paths: src')
    invalid('priority_paths: [1]')
    invalid('initial_version: one')
    invalid('sections: 1')
    invalid('changelogs: []')
    invalid('language: en\nchangelogs:\n  - language: pt-BR\n')
    invalid('changelogs:\n  - language: e n\n')
    invalid('changelogs:\n  - language: en_US\n')
    invalid('changelogs:\n  - language: 3\n')
    invalid('changelogs:\n  - {}\n')
    invalid('changelogs:\n  - language: en\n    other: 1\n')
    invalid('changelogs:\n  - language: en\n    no_user_facing_changes: Nada\n')
    invalid('changelogs:\n  - language: en\n    support: false\n')
    invalid('model: ""')
    invalid('model: 3')
    invalid('effort: extreme')
    invalid('effort: 3')
    invalid('support: ""')
    invalid('support: 3')
    invalid('changelogs:\n  - language: en\n    path: ../outside.md\n')
    invalid('changelogs:\n  - language: en\n    release_path: docs/same.md\n')
    invalid('changelogs:\n  - language: en\n  - language: pt-BR\n')
    invalid('changelogs:\n  - language: en\n  - language: en\n    path: b.md\n')
    invalid('changelogs:\n  - language: en\n    path: a.md\n  - language: pt-BR\n    path: a.md\n')
    invalid('changelogs:\n  - language: en\n  - language: pt-BR\n    path: b.md\n    sections:\n      other: O\n')
  })
})

describe('version files', () => {
  it('infers the format from the extension', () => {
    assert.deepEqual(declaredVersionFile({ json_path: '$.v', path: 'a/b.json' }), {
      format: 'json',
      jsonPath: '$.v',
      kind: 'structured',
      path: 'a/b.json',
    })
  })

  it('needs exactly one way of finding the version', () => {
    for (const declared of [
      { path: 'a.json' },
      { json_path: '$.v', path: 'a.json', pattern: 'v(.*)' },
      { json_path: '$.v', path: 'a.md' },
      { path: 'a.md', pattern: 'no group' },
      { path: 'a.md', pattern: '(' },
      {},
    ]) {
      assert.throws(() => declaredVersionFile(declared), InvalidConfigurationError)
    }
  })

  it('replaces the capture itself, not the first text that looks like it', () => {
    const file = declaredVersionFile({ path: 'a.md', pattern: '^v\\d\\.\\d (\\d)' })
    assert.equal(file.kind, 'pattern')
    if (file.kind === 'pattern') {
      assert.equal(withNewVersion('v1.1 1\n', file, '2.0.0'), 'v1.1 2.0.0\n')
    }
  })

  it('replaces only the captured version and keeps the rest of the line', () => {
    const file = declaredVersionFile({ path: 'SKILL.md', pattern: '^version: (\\S+)' })
    assert.equal(file.kind, 'pattern')
    if (file.kind === 'pattern') {
      const content = 'name: x\nversion: 1.5.0 # kept\nother: 1.5.0\n'
      assert.equal(withNewVersion(content, file, '1.6.0'), 'name: x\nversion: 1.6.0 # kept\nother: 1.5.0\n')
      assert.throws(() => withNewVersion('nothing here', file, '1.6.0'), InvalidConfigurationError)
      assert.throws(() => withNewVersion('other: 1.6.0\n', file, '1.6.0'), InvalidConfigurationError)
      assert.equal(withNewVersion('version: 1.6.0\n', file, '1.6.0'), 'version: 1.6.0\n')
    }
  })
})

describe('release documents', () => {
  it('writes the heading with the comparison when there is a previous tag', () => {
    const today = new Date('2026-11-02T12:00:00Z')
    assert.equal(
      releaseHeading('o/r', { previousTag: 'v1.0.0', version: '1.1.0' }, today),
      '## [1.1.0](https://github.com/o/r/compare/v1.0.0...v1.1.0) (2026-11-02)',
    )
    assert.equal(releaseHeading('o/r', { previousTag: undefined, version: '1.0.0' }, today), '## 1.0.0 (2026-11-02)')
  })

  it('starts a changelog that does not exist', () => {
    assert.equal(changelogWithEntry(undefined, '## 1.0.0\n\nText.'), '# Changelog\n\n## 1.0.0\n\nText.\n')
  })

  it('puts the entry above the last release and below the title', () => {
    assert.equal(
      changelogWithEntry('# Changelog\n\n## 1.0.0\n\nOld.\n', '## 1.1.0\n\nNew.'),
      '# Changelog\n\n## 1.1.0\n\nNew.\n\n## 1.0.0\n\nOld.\n',
    )
  })

  it('handles a changelog with no title or no release', () => {
    assert.equal(changelogWithEntry('## 1.0.0\n\nOld.\n', '## 1.1.0'), '## 1.1.0\n\n## 1.0.0\n\nOld.\n')
    assert.equal(changelogWithEntry('# Changelog\n', '## 1.1.0'), '# Changelog\n\n## 1.1.0\n')
  })

  it('keeps the release state out of the published notes', () => {
    const body = pullRequestBodyOf('## 1.0.0\n\nText.\n', { fingerprint: 'abc', version: '1.0.0' })
    assert.deepEqual(stateOfPullRequest(body), { fingerprint: 'abc', version: '1.0.0' })
    assert.equal(notesOfPullRequest(body), '## 1.0.0\n\nText.\n')
    assert.equal(stateOfPullRequest('just text'), undefined)
    assert.equal(stateOfPullRequest(null), undefined)
  })

  it('changes the fingerprint with anything the notes are written from', () => {
    const base = { commitShas: ['a'], configuration: 'x', hacsManifest: undefined, version: '1.0.0' }
    const fingerprint = notesFingerprint(base)
    assert.equal(notesFingerprint({ ...base }), fingerprint)
    assert.notEqual(notesFingerprint({ ...base, commitShas: ['a', 'b'] }), fingerprint)
    assert.notEqual(notesFingerprint({ ...base, configuration: 'y' }), fingerprint)
    assert.notEqual(notesFingerprint({ ...base, hacsManifest: '{}' }), fingerprint)
    assert.notEqual(notesFingerprint({ ...base, version: '2.0.0' }), fingerprint)
  })
})

describe('notes', () => {
  const textOf = (notes: ReturnType<typeof writtenNotes>, source = sourceOf(), yaml?: string) =>
    composedNotes(notes, source, english(yaml))[0].text

  it('groups the entries under the sections, in order, with links', () => {
    const text = textOf(
      writtenNotes(writtenEntry('fixed', 'Fixed.', [3]), writtenEntry('added', 'Added.', [99])),
      sourceOf({ pull_request_number: 3 }),
    )
    assert.equal(text, '### New features\n\n- Added.\n\n### Bug fixes\n\n- Fixed. ([#3](https://github.com/owner/project/pull/3))\n')
  })

  it('writes the title above the summary', () => {
    const notes = { ...writtenNotes(writtenEntry('added', 'Added.')), summary: { en: 'Headline.' }, title: { en: 'The Title' } }
    assert.equal(textOf(notes, sourceOf(), 'title: true'), '**The Title**\n\nHeadline.\n\n### New features\n\n- Added.\n')
  })

  it('writes each language in its own changelog', () => {
    const configuration = english('changelogs:\n  - language: pt-BR\n  - language: en\n    path: b.md\n')
    const notes = composedNotes(
      { entries: [{ category: 'fixed', pull_requests: [], text: { 'en': 'Fixed.', 'pt-BR': 'Corrigido.' } }], summary: { 'en': '', 'pt-BR': '' } },
      sourceOf(),
      configuration,
    )
    assert.match(notes[0].text, /### Correções\n\n- Corrigido\./)
    assert.match(notes[1].text, /### Bug fixes\n\n- Fixed\./)
  })

  it('rejects what must not reach a release', () => {
    const rejected = (notes: ReturnType<typeof writtenNotes>, source = sourceOf(), yaml?: string) =>
      assert.throws(() => textOf(notes, source, yaml), RejectedNotesError)
    rejected(writtenNotes(writtenEntry('added', 'See https://evil.test')))
    rejected(writtenNotes(writtenEntry('added', '![image](x)')))
    rejected(writtenNotes(writtenEntry('added', '<details>hidden')))
    rejected(writtenNotes(writtenEntry('added', '   ')))
    rejected(writtenNotes(writtenEntry('unknown', 'Text.')))
    rejected(writtenNotes(writtenEntry('added', 'Text.')), sourceOf(), 'title: true')
    rejected(writtenNotes(writtenEntry('added', 'Left **open')), sourceOf(), 'bold_entries: true')
    rejected(writtenNotes(writtenEntry('added', 'Text.')), sourceOf({ is_breaking: true }))
    rejected(writtenNotes(), sourceOf({ is_breaking: true }))
    rejected({ ...writtenNotes(writtenEntry('added', 'Text.')), title: { en: '**Bold**' } })
  })

  it('writes a mention as code, so it notifies nobody', () => {
    const text = textOf(writtenNotes(writtenEntry('added', 'Use @latest, @scope/package or `@v1`, thanks @someone.')))
    assert.equal(text, '### New features\n\n- Use `@latest`, `@scope/package` or `@v1`, thanks `@someone`.\n')
  })

  it('names the markup it rejects', () => {
    assert.throws(() => textOf(writtenNotes(writtenEntry('added', 'See https://evil.test'))), /HTML: https:\/\//)
  })

  it('accepts closed bold and an email-like address', () => {
    const text = textOf(writtenNotes(writtenEntry('added', 'A **closed** mark, me@example.test.')), sourceOf(), 'bold_entries: true')
    assert.match(text, /\*\*closed\*\*/)
  })
})

describe('release commits', () => {
  const details = {
    authorLogin: 'someone',
    files: [
      { additions: 1, deletions: 0, patch: 'x'.repeat(5_000), path: 'src/a.ts' },
      { additions: 1, deletions: 0, patch: 'lock', path: 'uv.lock' },
      { additions: 1, deletions: 0, patch: 'y'.repeat(5_000), path: 'docs/important.md' },
    ],
    message: 'feat: x',
    pullRequest: { body: 'z'.repeat(7_000), number: 3, title: 'Title' },
  }

  it('bounds what goes to the model and reads the priority files in full', () => {
    const commit = releaseCommitOf(details, false, english('priority_paths: [docs/]'))
    assert.equal(commit.files[0].path, 'docs/important.md')
    assert.equal(commit.files[0].patch.length, 5_000)
    assert.equal(commit.files.find((file) => file.path === 'src/a.ts')?.patch.length, 4_000)
    assert.equal(commit.files.find((file) => file.path === 'uv.lock')?.patch, '')
    assert.equal(commit.pull_request_description.length, 6_000)
  })

  it('reads no patch and no description from a bot', () => {
    const commit = releaseCommitOf({ ...details, authorLogin: 'dependabot[bot]' }, false, english('priority_paths: [docs/]'))
    assert.ok(commit.files.every((file) => file.patch === ''))
    assert.equal(commit.pull_request_description, '')
    assert.equal(commit.pull_request_title, 'Title')
  })
})
