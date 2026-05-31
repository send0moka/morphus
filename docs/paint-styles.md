# Paint Style Generation

Morphus can create local paint styles when repeated fills appear in the generated Figma output.

## Candidates

Good candidates include repeated brand colors, shared surface fills, and recurring text fills. One-off decorative paints should usually remain local to the node.

## Naming

Generated paint style names use either the document title namespace or the Morphus namespace:

```text
Landing Page / Color / Green / 500
Morphus / Color / Neutral / 900
```

## Pruning

When rebuilding the same document namespace, Morphus can prune stale generated styles while leaving unrelated user-created styles alone.

## Gradients And Images

Solid fills are easiest to reuse. Gradients and image fills should be reviewed carefully because they often encode position or context-specific behavior.

## Review Checklist

- Shared colors should create styles when repeated.
- One-off colors should not flood the style list.
- Existing user styles outside the current namespace should remain untouched.
