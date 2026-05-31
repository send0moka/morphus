# Code Style Guide

This document defines the TypeScript and JavaScript conventions used across the
Morphus codebase. All contributors should follow these rules before opening a PR.

## General Rules

- **Language**: TypeScript everywhere in `src/`; plain JavaScript for scripts
  in `scripts/` and benchmark files in `tests/benchmarks/`.
- **Target**: `ES2020` module output; Node 18+ for the companion, browser
  target for the plugin.
- **Line length**: 100 characters maximum.
- **Indentation**: 2 spaces, no tabs.
- **Trailing commas**: Required in multi-line structures (`"trailingComma": "all"`).
- **Semicolons**: Required.

## Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Variables and functions | camelCase | `parseCssValue` |
| Constants (module-level) | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| Classes | PascalCase | `MorphusError` |
| Interfaces and types | PascalCase | `ConversionOptions` |
| Enums | PascalCase members | `ErrorCode.PARSE_ERROR` |
| Files | kebab-case | `css-parser.ts` |

## TypeScript Specifics

- Prefer `interface` over `type` for object shapes; use `type` for unions and
  intersections.
- Avoid `any`; use `unknown` and narrow with type guards.
- Do not use `!` non-null assertions; handle null explicitly.
- Exported functions must have explicit return types.

## Imports

- Use named imports. Avoid `import *`.
- Group imports: (1) Node built-ins, (2) third-party, (3) local. Separate with
  blank lines.
- Use relative paths (`./`, `../`) for local imports; no path aliases.

## Comments

- Use JSDoc for all exported symbols (`/** ... */`).
- Use `// TODO(username): ...` format for deferred work.
- Avoid commented-out code; delete it and rely on git history.

## Linting and Formatting

```bash
npm run lint     # eslint with @typescript-eslint
npm run format   # prettier
```

Both must pass before a PR is merged. CI enforces this automatically.

## Related Docs

- [Development workflow](development-workflow.md)
- [Contributing](../CONTRIBUTING.md)
