cask "morphus-local" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/send0moka/morphus/releases/latest/download/Morphus%20Local%20macOS%20#{arch}.zip"
  name "Morphus Local"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/send0moka/morphus"

  app "Morphus Local macOS #{arch}/Morphus Local.app"

  uninstall quit: "com.morphus.local"
end
