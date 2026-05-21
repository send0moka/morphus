#!/usr/bin/env node
/**
 * Generates a versioned Homebrew Cask for Morphus Converter release assets.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const version = args.version || process.env.MORPHUS_CASK_VERSION;
const repo = args.repo || process.env.MORPHUS_CASK_REPO || 'send0moka/morphus';
const tag = args.tag || process.env.MORPHUS_CASK_TAG || `morphus-v${version}`;
const output = args.output || process.env.MORPHUS_CASK_OUTPUT || 'out/homebrew/Casks/morphus-converter.rb';
const armZip = args.armZip || args['arm-zip'] || process.env.MORPHUS_CASK_ARM_ZIP;
const intelZip = args.intelZip || args['intel-zip'] || process.env.MORPHUS_CASK_INTEL_ZIP;
const releaseNameStyle = args.releaseNameStyle || args['release-name-style'] || process.env.MORPHUS_CASK_RELEASE_NAME_STYLE || 'dotted';

if (!version) {
  throw new Error('Missing --version.');
}
if (!armZip) {
  throw new Error('Missing --arm-zip.');
}

const shas = {
  arm: sha256File(resolve(armZip)),
  ...(intelZip ? { intel: sha256File(resolve(intelZip)) } : {}),
};

const text = intelZip
  ? renderUniversalCask({ version, repo, tag, shas })
  : renderArmOnlyCask({ version, repo, tag, shas });

const outputPath = resolve(output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, text, 'utf8');
console.log(`Generated ${output}`);

function renderUniversalCask({ version, repo, tag, shas }) {
  const zipNameTemplate = releaseZipNameTemplate();
  return `cask "morphus-converter" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${shas.arm}",
         intel: "${shas.intel}"

  url "https://github.com/${repo}/releases/download/${tag}/${zipNameTemplate}"
  name "Morphus Converter"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/${repo}"

  app "Morphus Converter.app"

  uninstall quit: "com.morphus.converter"
end
`;
}

function renderArmOnlyCask({ version, repo, tag, shas }) {
  const zipName = releaseZipName('arm64', armZip);
  return `cask "morphus-converter" do
  version "${version}"
  sha256 "${shas.arm}"

  url "https://github.com/${repo}/releases/download/${tag}/${zipName}"
  name "Morphus Converter"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/${repo}"

  depends_on arch: :arm64

  app "Morphus Converter.app"

  uninstall quit: "com.morphus.converter"
end
`;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function releaseZipNameTemplate() {
  if (releaseNameStyle === 'original') {
    return 'Morphus%20Converter%20macOS%20#{arch}.zip';
  }
  if (releaseNameStyle === 'dotted-versioned') {
    return `Morphus.Converter.macOS.#{arch}.v${version}.zip`;
  }
  return 'Morphus.Converter.macOS.#{arch}.zip';
}

function releaseZipName(arch, fallbackPath) {
  if (releaseNameStyle === 'original') {
    return basename(fallbackPath).replace(/ /g, '%20');
  }
  if (releaseNameStyle === 'dotted-versioned') {
    return `Morphus.Converter.macOS.${arch}.v${version}.zip`;
  }
  return `Morphus.Converter.macOS.${arch}.zip`;
}

function parseArgs(items) {
  const result = {};
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const value = items[index + 1] && !items[index + 1].startsWith('--')
      ? items[++index]
      : '1';
    result[toCamelCase(key)] = value;
    result[key] = value;
  }
  return result;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
