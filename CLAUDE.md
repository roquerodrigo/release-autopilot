# release-autopilot

GitHub Action that cuts semantic releases with notes written by Claude. `README.md` is
the public contract: inputs, outputs and `.release-autopilot.yml`. Consumers track
`@v1`, which `self-release.yml` moves on every release, so a release is live everywhere
on its next run: treat those names as a public contract, and break them only with a new
major version.

## Architecture

- `src/domain`: pure rules. Commits, configuration, notes, documents. No I/O.
- `src/application`: the three use cases, `PublishMergedRelease`,
  `PrepareReleasePullRequest` and `PreviewPastRelease`, behind the ports in `ports.ts`.
- `src/infrastructure`: the adapters. GitHub, Claude and the planner. The default prompt
  is `default-notes-prompt.md`, generic for any project and embedded in the bundle.
- `src/release-autopilot.ts`: wires everything behind `ReleaseAutopilot`, the public API
  of the npm package (`src/index.ts`).
- `src/action.ts` reads the inputs of the action and `src/cli.ts` the arguments of the
  command line, and both call `ReleaseAutopilot`. `src/main.ts` and `src/bin.ts` only
  run them.

## The engine stays hidden

`release-please` only decides: next version, commits since the last release, which of
them are breaking and the content of the structured version files. `src/infrastructure/release-please-planner.ts`
is the only file allowed to import it, and only through its public exports. Everything
visible is written here: branch `release/<target>`, pull request, tag and release.

Never let the engine reach a consumer: no configuration file, manifest, label, branch
name, annotation or log line of its own. Its `buildPullRequests()` is read-only, and
nothing here calls its write paths (`createPullRequests`, `createReleases`).

## Verifying a change

- `npx eslint`, `npm test` (type check, tests and coverage). The tests run the real
  adapters against `tests/fake-github.ts` and `tests/fake-claude.ts`; coverage only
  counts files the tests load, so a new adapter needs a test that reaches it.
- Never commit `dist/`. The action runs the bundle at its tag, and only the release pull
  request carries it: `self-bundle.yml` builds it there, and CI fails a release pull
  request whose bundle is stale.
- `npm run build:package` builds the npm package into `lib/`. `self-release.yml`
  publishes it at each release through trusted publishing.
- `eslint --fix` sorts object keys: never rely on the order of a literal's keys.
