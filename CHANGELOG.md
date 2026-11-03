# Changelog

## [1.4.0](https://github.com/roquerodrigo/release-autopilot/compare/v1.3.0...v1.4.0) (2026-11-03)

Release Autopilot is now published on npm with a command line and a library, so releases can run outside GitHub Actions.

### New features

- The release can now run outside GitHub Actions through the release-autopilot npm package and its npx command, which prints its outcome as JSON. ([#16](https://github.com/roquerodrigo/release-autopilot/pull/16))
- The package also exports a ReleaseAutopilot class, so the release can be run from code with the same behaviour as the action. ([#16](https://github.com/roquerodrigo/release-autopilot/pull/16))

## [1.3.0](https://github.com/roquerodrigo/release-autopilot/compare/v1.2.0...v1.3.0) (2026-11-03)

Release notes can now be written in any language tag, with regional variants of English using the built-in English texts.

### New features

- The `language` option accepts any language tag, such as `es` or `en-GB`, and a language without built-in texts declares its section titles and support text. ([#14](https://github.com/roquerodrigo/release-autopilot/pull/14))
- Language tags are accepted in any letter case, so `PT-br` and `pt-BR` give the same notes. ([#14](https://github.com/roquerodrigo/release-autopilot/pull/14))

### Improvements

- Regional English variants such as `en-GB` and `en-US` now use the built-in English texts. ([#14](https://github.com/roquerodrigo/release-autopilot/pull/14))
- Notes for a HACS project are written in the language of its declared countries when they share one built-in language, and in English otherwise. ([#14](https://github.com/roquerodrigo/release-autopilot/pull/14))

## [1.2.0](https://github.com/roquerodrigo/release-autopilot/compare/v1.1.2...v1.2.0) (2026-11-03)

### Improvements

- Updates to dependencies that reach those who install the project now open a release on their own, since they may close a vulnerability. ([#12](https://github.com/roquerodrigo/release-autopilot/pull/12))

## [1.1.2](https://github.com/roquerodrigo/release-autopilot/compare/v1.1.1...v1.1.2) (2026-11-03)

### New features

- A latest tag now follows every release, including those with a new major version, so it always points at the newest version. ([#9](https://github.com/roquerodrigo/release-autopilot/pull/9))

### Bug fixes

- Release notes that name a reference such as latest no longer block the release with an error about a mention. ([#10](https://github.com/roquerodrigo/release-autopilot/pull/10))

## [1.1.1](https://github.com/roquerodrigo/release-autopilot/compare/v1.1.0...v1.1.1) (2026-11-03)

### Improvements

- A major version tag such as v1 now follows each release, so users can track it and receive only released changes. ([#7](https://github.com/roquerodrigo/release-autopilot/pull/7))

## [1.1.0](https://github.com/roquerodrigo/release-autopilot/compare/v1.0.0...v1.1.0) (2026-11-03)

### Improvements

- The action's log now explains each run: the next version, the model used, and why no release pull request was opened or changed. ([#5](https://github.com/roquerodrigo/release-autopilot/pull/5))

## 1.0.0 (2026-11-03)

First release: a GitHub Action that prepares reviewed release pull requests and publishes the release when they are merged.

### New features

- Adds a GitHub Action that keeps one release pull request up to date on every push, with the next version, changelog and notes. ([#1](https://github.com/roquerodrigo/release-autopilot/pull/1))
- Merging the release pull request publishes the tag and GitHub release with the reviewed notes, and needs no configuration file. ([#1](https://github.com/roquerodrigo/release-autopilot/pull/1))
