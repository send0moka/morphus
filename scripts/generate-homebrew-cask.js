#!/usr/bin/env node
/**
 * Generates a versioned Homebrew Cask for Morphus Local release assets.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const version = args.version || process.env.MORPHUS_CASK_VERSION;
const repo = args.repo || process.env.MORPHUS_CASK_REPO || 'send0moka/morphus';
const tag = args.tag || process.env.MORPHUS_CASK_TAG || `local-companion-v${version}`;
const output = args.output || process.env.MORPHUS_CASK_OUTPUT || 'out/homebrew/Casks/morphus-local.rb';
const armZip = args.armZip || args['arm-zip'] || process.env.MORPHUS_CASK_ARM_ZIP;
const intelZip = args.intelZip || args['intel-zip'] || process.env.MORPHUS_CASK_INTEL_ZIP;

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
  return `cask "morphus-local" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${shas.arm}",
         intel: "${shas.intel}"

  url "https://github.com/${repo}/releases/download/${tag}/Morphus%20Local%20macOS%20#{arch}.zip"
  name "Morphus Local"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/${repo}"

  app "Morphus Local macOS #{arch}/Morphus Local.app"

  uninstall quit: "com.morphus.local"
end
`;
}

function renderArmOnlyCask({ version, repo, tag, shas }) {
  const zipName = basename(armZip).replace(/ /g, '%20');
  return `cask "morphus-local" do
  version "${version}"
  sha256 "${shas.arm}"

  url "https://github.com/${repo}/releases/download/${tag}/${zipName}"
  name "Morphus Local"
  desc "Local converter companion for the Morphus Figma plugin"
  homepage "https://github.com/${repo}"

  depends_on arch: :arm64

  app "Morphus Local macOS arm64/Morphus Local.app"

  uninstall quit: "com.morphus.local"
end
`;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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
