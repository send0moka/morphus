# Changelog Conventions

Morphus follows [Keep a Changelog](https://keepachangelog.com/) conventions and
uses [Semantic Versioning](https://semver.org/).

## File Location

The changelog lives at `CHANGELOG.md` in the repository root.

## Entry Format

```markdown
## [Unreleased]

### Added
- New feature or document.

### Changed
- Modification to existing behaviour.

### Deprecated
- Features that will be removed in a future version.

### Removed
- Features removed in this release.

### Fixed
- Bug fixes.

### Security
- Vulnerability patches.
```

## Version Bump Rules

| Change type | Version component bumped |
|---|---|
| Breaking API or protocol change | Major (`x.0.0`) |
| New feature (backward-compatible) | Minor (`0.x.0`) |
| Bug fix, docs, refactor | Patch (`0.0.x`) |

## Release Workflow

1. Move all `[Unreleased]` entries under a new `## [x.y.z] – YYYY-MM-DD`
   heading.
2. Create a new empty `[Unreleased]` section at the top.
3. Update the comparison links at the bottom of the file.
4. Create a git tag: `git tag v<x.y.z>`.
5. Push the tag: `git push origin v<x.y.z>`.
6. The release CI workflow picks up the tag and builds installers automatically.

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Examples:

```
feat(converter): support CSS custom properties (variables)
fix(companion): handle EADDRINUSE on startup
docs(testing): add benchmark section
```

## Related Docs

- [Release checklist](release-checklist.md)
- [CI pipeline](ci-pipeline.md)
- [Development workflow](development-workflow.md)
