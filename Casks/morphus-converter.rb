cask "morphus-converter" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/send0moka/morphus/releases/latest/download/Morphus.Converter.macOS.#{arch}.zip"
  name "Morphus Converter"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/send0moka/morphus"

  app "Morphus Converter macOS #{arch}/Morphus Converter.app"

  uninstall quit: "com.morphus.converter"
end
