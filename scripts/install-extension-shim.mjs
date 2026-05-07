#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const extensionName = "copilot-cli-cost";
const extensionRelativePath = path.join(".github", "extensions", extensionName, "extension.mjs");

try {
  const sourceExtension = findInstalledExtension();
  const targetDirectory = path.join(os.homedir(), ".copilot", "extensions", extensionName);
  const targetExtension = path.join(targetDirectory, "extension.mjs");
  const content = `import { pathToFileURL } from "node:url";\n\nawait import(pathToFileURL(${JSON.stringify(sourceExtension)}).href);\n`;

  if (fs.existsSync(targetExtension)) {
    const existing = fs.readFileSync(targetExtension, "utf8");
    if (existing === content) {
      console.log(`Copilot Cost extension shim is already installed at ${targetExtension}`);
      process.exit(0);
    }
    if (!existing.includes(extensionName)) {
      throw new Error(`Refusing to overwrite existing non-Copilot-Cost extension at ${targetExtension}`);
    }
  }

  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(targetExtension, content);
  console.log(`Installed Copilot Cost extension shim at ${targetExtension}`);
  console.log(`Shim imports ${pathToFileURL(sourceExtension).href}`);
} catch (error) {
  console.error(`install-extension-shim: ${error.message}`);
  process.exitCode = 1;
}

function findInstalledExtension() {
  const installedPluginsDirectory = path.join(os.homedir(), ".copilot", "installed-plugins");
  const matches = findFiles(installedPluginsDirectory, path.basename(extensionRelativePath))
    .filter((file) => path.normalize(file).endsWith(extensionRelativePath));

  if (matches.length === 0) {
    throw new Error(`Could not find ${extensionRelativePath} under ${installedPluginsDirectory}. Install the plugin first.`);
  }

  matches.sort();
  return matches[0];
}

function findFiles(directory, fileName) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const results = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
