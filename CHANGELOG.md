# Changelog

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
