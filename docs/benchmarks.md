# Performance Benchmarks

This document records baseline conversion timings and explains how to run and
update benchmarks for Morphus.

## Benchmark Setup

Benchmarks live in `tests/benchmarks/` and use the Node.js `perf_hooks` API so
they run without an additional framework.

```
tests/
  benchmarks/
    bench-converter.mjs   # measures full CSS→Figma pipeline
    bench-css-parse.mjs   # isolates CSS parsing cost
    bench-color.mjs       # measures color utility throughput
    README.md             # how to run and compare
```

## Running Benchmarks

```bash
node tests/benchmarks/bench-converter.mjs
node tests/benchmarks/bench-css-parse.mjs
node tests/benchmarks/bench-color.mjs
```

Each script prints median, p95, and p99 durations over 100 iterations.

## Baseline Results (v0.1)

| Benchmark | Input | Median | p95 |
|---|---|---|---|
| Full conversion | 50-node HTML | 14 ms | 22 ms |
| CSS parse only | 200-rule stylesheet | 3 ms | 5 ms |
| Color utilities | 1000 hex→rgb calls | 0.4 ms | 0.7 ms |

> These numbers were recorded on an Apple M1 with Node 20 LTS. Results vary by
> machine. Use them as relative indicators, not absolute targets.

## Adding a New Benchmark

1. Create `tests/benchmarks/bench-<topic>.mjs`.
2. Import the target module from `src/`.
3. Use the `benchmark(label, fn, iterations)` helper from
   `tests/benchmarks/_helpers.mjs`.
4. Record the p95 result in the table above after running on a reference machine.

## Regression Detection

CI does not enforce benchmark thresholds yet. The recommended approach is to run
benchmarks locally before and after a change to a hot path and record the delta
in the PR description.

## Related Docs

- [Testing guide](testing.md)
- [Fixture authoring](fixture-authoring.md)
- [Development workflow](development-workflow.md)
