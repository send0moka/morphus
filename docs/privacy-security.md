# Privacy And Security

Morphus converts user-provided HTML into Figma layers. Treat that HTML as potentially private and potentially hostile.

## Local Converter

The local companion should listen on localhost by default:

```text
HOST=localhost
MORPHUS_PORT=3210
```

Keep local conversion private to the current machine unless you intentionally deploy a public service.

## Public Converter

Before exposing Morphus on the public internet:

- Add rate limiting.
- Add request size limits.
- Keep conversion timeouts enabled.
- Log operational metadata, not full submitted HTML.
- Use HTTPS.
- Restrict Figma plugin `networkAccess.allowedDomains` to the exact converter domain.

Public deployments should assume submitted HTML may contain confidential UI, customer data, or internal product details.

## HTML Input

The converter renders HTML in Playwright, so input should be handled as untrusted content.

Recommended safeguards:

- Avoid persisting submitted HTML unless explicitly needed.
- Prefer short-lived job data.
- Do not echo raw HTML into logs.
- Keep browser execution isolated from secrets and internal networks.
- Block or limit outbound network access in public deployments when possible.

## Web Fonts And Assets

Remote fonts and images can reveal network access patterns or depend on third-party availability.

- Confirm font licenses before installing captured web fonts.
- Avoid auto-installing fonts in shared or server environments.
- Prefer local or inline assets for deterministic tests.
- Document when a conversion depends on external assets.

## GitHub Releases

Release artifacts should not include local secrets, personal tokens, private HTML samples, or generated output from confidential pages.

Before publishing, inspect package contents and release notes for accidental sensitive data.
