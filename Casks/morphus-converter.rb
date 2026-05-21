cask "morphus-converter" do
  arch arm: "arm64", intel: "x64"

  version "0.1.4"
  sha256 :no_check

  url "https://github.com/send0moka/morphus/releases/download/morphus-v#{version}/Morphus.Converter.macOS.#{arch}.v#{version}.dmg"
  name "Morphus Converter"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/send0moka/morphus"

  app "Morphus Converter.app"

  uninstall quit: "com.morphus.converter"
end
