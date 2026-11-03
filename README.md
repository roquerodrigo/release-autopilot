# Release Autopilot

[![Marketplace](https://img.shields.io/badge/Marketplace-Release%20Autopilot-2088ff?logo=githubactions&logoColor=white&style=for-the-badge)](https://github.com/marketplace/actions/release-autopilot)
[![Release](https://img.shields.io/github/v/release/roquerodrigo/release-autopilot?style=for-the-badge)](https://github.com/roquerodrigo/release-autopilot/releases/latest)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white&style=for-the-badge)](https://github.com/sponsors/roquerodrigo)

Semantic releases with notes written for the people who use the project, not a list
of commits.

Every push to the default branch keeps one release pull request up to date: the next
version, the version files, the changelog and the notes. Merging it publishes the tag
and the GitHub release with the text you reviewed. The pull request carries its final
notes from its first write, and nothing rewrites it afterwards.

## Usage

The action is listed on the
[GitHub Marketplace](https://github.com/marketplace/actions/release-autopilot). Add the
workflow below, and the secret `ANTHROPIC_API_KEY` with a key for the Claude API:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

permissions: {}

jobs:
  release:
    permissions:
      contents: write
      pull-requests: write
    uses: roquerodrigo/release-autopilot/.github/workflows/release.yml@v1
    secrets:
      token: ${{ secrets.RELEASE_TOKEN }}
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

  publish:
    needs: release
    if: needs.release.outputs.released == 'true'
    # Publish needs.release.outputs.tag to a registry here.
```

No file is required in the repository. `@v1` follows every 1.x release, and a breaking
change only arrives with a new major version, such as `@v2`. `@latest` follows every
release, breaking ones included. To stay on one version,
use the tag of a [release](https://github.com/roquerodrigo/release-autopilot/releases),
such as `@v1.1.0`, or its commit. The workflow is a thin wrapper around the action and
runs the action at its own commit, so pinning the workflow pins both. The action can
also be used as a step:

```yaml
- uses: roquerodrigo/release-autopilot@v1
  id: release
  with:
    token: ${{ secrets.RELEASE_TOKEN }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

`token` needs contents and pull-requests write access. The default `GITHUB_TOKEN`
works once **Allow GitHub Actions to create and approve pull requests** is enabled in
the settings of the repository, under Actions, but its pushes trigger no workflows, so
a release pull request opened with it runs no checks.

| Output         | Meaning                                       |
| -------------- | --------------------------------------------- |
| `released`     | `"true"` when this run published a release    |
| `tag`          | The tag published by this run, if any         |
| `version`      | The version published by this run, if any     |
| `pull-request` | The URL of the open release pull request, if any |

`dry-run: true` plans the release and writes its notes, printing what would change
without changing anything. Nothing counts as published, so `released` stays `"false"`.
`preview-previous-tag` and `preview-release-tag` write the notes of a past release to
the job summary, to judge a prompt by what it produces.

## What it does

**The version** comes from the conventional commits since the last `vX.Y.Z` tag. Before
`1.0.0`, a breaking change bumps the minor and a feature bumps the patch. A
`Release-As: 2.0.0` footer picks the version by hand. With no conventional commit since
the last tag there is no version to pick, so no release opens. The first release is
`1.0.0`, unless `initial_version` says otherwise.

A version whose tag already exists fails the run, and so does restarting from the first
version when the last tag is too far back in the history to be found: `initial_version`
then sets the next one.

**A release** opens when Claude finds something in the commits that matters to the
people who use the project. Every commit since the last tag reaches it, conventional or
not and whatever its type: a CI change or a development dependency waits, unreleased,
until something relevant comes along. An update of a dependency that reaches the people
who install the project opens one on its own, since it may close a vulnerability: a
change to the dependencies declared in `package.json`, `pyproject.toml` or the manifest
of a plugin, or to the lockfile of something shipped built, such as a container image.
A breaking commit always opens one.

**The version files** are found on their own, and most projects declare none:

| File                                   | Version                    |
| -------------------------------------- | -------------------------- |
| `custom_components/*/manifest.json`    | `version`                  |
| `pyproject.toml`                       | `project.version`, unless it is dynamic |
| `uv.lock`                              | The entry of the project   |
| `package.json`, `package-lock.json`    | `version`                  |
| `version.txt`                          | The whole file             |

A file that does not take the new version fails the run, rather than leaving a stale
version behind, and so does a declared file that does not exist.

**The notes** are written by Claude from the commits, their pull requests and their
patches, in the language of the project. The pull request, `CHANGELOG.md` and the
release all carry that text. Edit the pull request before merging and the release
follows the edit.

- A hidden comment in the pull request records what the notes were written from. While
  the commits, the version and the configuration stay the same, a run neither calls the
  model nor touches the pull request.
- A failure to write the notes leaves the pull request as it is and fails the run, and
  the next push tries again. There is no fallback text. A release that was already
  merged is still published, and the run then only warns.
- The model has no tools. Its text is rejected if it carries a link, an image or HTML,
  or omits a breaking commit, and a mention such as `@latest` is written as code, so it
  notifies nobody. Patches and descriptions from bots never reach it.
- A pull request left with nothing relevant to release is closed.

By default the release ends with a section that invites sponsorship, in its language,
linking to the sponsors page of the owner of the repository. `support: false` leaves it
out and a text replaces it. That section stays out of the changelogs, where it would
repeat for every version.

The notes are in pt-BR when `hacs.json` declares `"country": ["BR"]`, and in English
otherwise.

## Configuration

Everything goes in an optional `.release-autopilot.yml` at the root of the repository,
read from the commit being released. Every field can be left out:

```yaml
# The language of the notes, "en" or "pt-BR".
language: pt-BR

# Replaces the guidance on what to write and how, which by default is
# src/infrastructure/default-notes-prompt.md. The rules on markup, breaking commits and
# instructions found in the data still apply. `summary` is the text above the sections,
# so the prompt decides what goes there.
prompt: |
  You write the patch notes of a game for the people who play it.

# The model that writes the notes, and its effort: low, medium, high, xhigh or max.
model: claude-haiku-5-5
effort: medium

# Asks for a title of a few words, written in bold above the text.
title: true

# Lets the model put in bold, inside each entry, the part a reader should not miss.
bold_entries: true

# Read first and in full. The limits on the size of a patch only cut other files.
priority_paths:
  - src/data/
  - docs/changes.md

# The version of the first release, when the repository has no tag yet.
initial_version: 0.1.0

# The section at the end of the release that invites sponsorship. Leave it out with
# `false`, or replace it with a text, where {url} is the sponsors page of the owner.
support: false

# One title per section, in the order they appear. A `breaking` section is always
# there, first.
sections:
  balance: Balance
  fixes: Bug fixes

# A version file that is not found on its own. `json_path` reads JSON, TOML and YAML.
# `pattern` reads anything: one capture group around the version.
version_files:
  - path: src/manifest.json
    json_path: $.version
  - path: SKILL.md
    pattern: '^version: (\S+)'
```

A file that cannot be used fails the run before anything is written.

### Several languages and files

To keep the notes in another file, or in several languages, list the changelogs. The
first one is the language of the pull request and the release, and `sections` moves
inside each entry. All the languages come from one call to the model, entry by entry,
so they cannot list different changes:

```yaml
changelogs:
  - language: pt-BR
    path: CHANGELOG.md

  - language: en
    path: docs/CHANGELOG.en.md
    # The same text in a file of its own for each release. It needs {version}.
    release_path: docs/releases/en/{version}.md

  # A language other than "en" and "pt-BR" declares its sections.
  - language: es
    path: docs/CHANGELOG.es.md
    sections:
      breaking: Cambios incompatibles
      added: Novedades
      changed: Mejoras
      fixed: Correcciones
```

Every changelog needs the same sections. The first one keeps `CHANGELOG.md` when it
names no path, and any other needs a `path`, a `release_path` or both. `support` stays
at the top of the file, and needs a text or `false` when the first language is neither
"en" nor "pt-BR".

## Support

This project is built and maintained on personal time. If it is useful to you, consider [sponsoring the work](https://github.com/sponsors/roquerodrigo) — it keeps the development, the testing and the releases coming.
