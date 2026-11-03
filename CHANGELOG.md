# Changelog

## [1.1.0](https://github.com/roquerodrigo/release-autopilot/compare/v1.0.0...v1.1.0) (2026-11-03)

### Improvements

- The action's log now explains each run: the next version, the model used, and why no release pull request was opened or changed. ([#5](https://github.com/roquerodrigo/release-autopilot/pull/5))

## 1.0.0 (2026-11-03)

First release: a GitHub Action that prepares reviewed release pull requests and publishes the release when they are merged.

### New features

- Adds a GitHub Action that keeps one release pull request up to date on every push, with the next version, changelog and notes. ([#1](https://github.com/roquerodrigo/release-autopilot/pull/1))
- Merging the release pull request publishes the tag and GitHub release with the reviewed notes, and needs no configuration file. ([#1](https://github.com/roquerodrigo/release-autopilot/pull/1))
