# Homebrew Formula

Morphus provides a Homebrew tap so macOS users can install the companion with
a single command.

## Installing via Homebrew

```bash
brew tap send0moka/morphus
brew install morphus
```

This installs the `morphus` binary (the compiled local companion) to
`/opt/homebrew/bin/morphus` (Apple Silicon) or `/usr/local/bin/morphus` (Intel).

## Starting the Companion

```bash
morphus --port 3000 --secret <your-secret>
```

Or configure via environment:

```bash
MORPHUS_SECRET=<your-secret> morphus
```

## Tap Repository

The Homebrew tap lives at
[`send0moka/homebrew-morphus`](https://github.com/send0moka/homebrew-morphus).

The formula file (`Formula/morphus.rb`) looks like:

```ruby
class Morphus < Formula
  desc "Local companion for the Morphus Figma plugin"
  homepage "https://github.com/send0moka/morphus"
  version "0.1.0"
  url "https://github.com/send0moka/morphus/releases/download/v0.1.0/morphus-macos.tar.gz"
  sha256 "<sha256-of-tarball>"
  license "MIT"

  def install
    bin.install "morphus"
  end

  test do
    system "#{bin}/morphus", "--version"
  end
end
```

## Updating the Formula After a Release

1. Build the macOS binary (see [OS packaging guide](os-packaging.md)).
2. Upload the `.tar.gz` to the GitHub Release.
3. Compute the SHA-256: `shasum -a 256 morphus-macos.tar.gz`.
4. Update `version`, `url`, and `sha256` in the formula.
5. Open a PR in the tap repo.
6. Merge; the formula is live immediately.

## Uninstalling

```bash
brew uninstall morphus
brew untap send0moka/morphus
```

## Related Docs

- [OS packaging guide](os-packaging.md)
- [Deployment](deployment.md)
- [Release checklist](release-checklist.md)
