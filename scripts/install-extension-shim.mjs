#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const extensionName = "copilot-cli-cost";
const extensionRelativePath = path.join(".github", "extensions", extensionName, "extension.mjs");

try {
  const copilotHome = readCopilotHome(process.argv.slice(2));
  const sourceExtension = findInstalledExtension(copilotHome);
  const targetDirectory = path.join(copilotHome, "extensions", extensionName);
  const targetExtension = path.join(targetDirectory, "extension.mjs");
  const content = renderShim(sourceExtension);

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

function readCopilotHome(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--copilot-home") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--copilot-home requires a value.");
      }
      return path.resolve(value);
    }
  }
  return path.resolve(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"));
}

function findInstalledExtension(copilotHome) {
  const installedPluginsDirectory = path.join(copilotHome, "installed-plugins");
  const matches = findFiles(installedPluginsDirectory, path.basename(extensionRelativePath))
    .filter((file) => path.normalize(file).endsWith(extensionRelativePath));

  if (matches.length === 0) {
    throw new Error(
      `Could not find ${extensionRelativePath} under ${installedPluginsDirectory}. ` +
      "Run install.ps1/install.sh first."
    );
  }

  matches.sort();
  return matches[0];
}

function renderShim(sourceExtension) {
  return `import { pathToFileURL } from "node:url";\n\nawait import(pathToFileURL(${JSON.stringify(sourceExtension)}).href);\n`;
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
