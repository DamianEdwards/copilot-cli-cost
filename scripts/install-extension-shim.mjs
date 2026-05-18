#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const extensionName = "copilot-cli-cost";
const extensionRelativePath = path.join(".github", "extensions", extensionName, "extension.mjs");

try {
  const copilotHome = readCopilotHome(process.argv.slice(2));
  const localSourceExtension = findLocalSourceExtension(copilotHome);
  const sourceExtension = localSourceExtension ?? findInstalledExtension(copilotHome, { required: true });
  const fallbackExtension = localSourceExtension
    ? findInstalledExtension(copilotHome, { required: false })
    : undefined;
  const targetDirectory = path.join(copilotHome, "extensions", extensionName);
  const targetExtension = path.join(targetDirectory, "extension.mjs");
  const content = renderShim({
    fallbackExtension,
    sourceExtension
  });

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
  console.log(`Shim prefers ${pathToFileURL(sourceExtension).href}`);
  if (fallbackExtension && fallbackExtension !== sourceExtension) {
    console.log(`Shim falls back to ${pathToFileURL(fallbackExtension).href}`);
  }
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

function findLocalSourceExtension(copilotHome) {
  const candidate = path.resolve(import.meta.dirname, "..", extensionRelativePath);
  if (!fs.existsSync(candidate)) {
    return undefined;
  }

  const installedPluginsDirectory = path.join(copilotHome, "installed-plugins");
  if (isSameOrDescendantPath(import.meta.dirname, installedPluginsDirectory)) {
    return undefined;
  }

  return candidate;
}

function findInstalledExtension(copilotHome, { required } = { required: true }) {
  const installedPluginsDirectory = path.join(copilotHome, "installed-plugins");
  const matches = findFiles(installedPluginsDirectory, path.basename(extensionRelativePath))
    .filter((file) => path.normalize(file).endsWith(extensionRelativePath));

  if (matches.length === 0) {
    if (!required) {
      return undefined;
    }
    throw new Error(`Could not find ${extensionRelativePath} under ${installedPluginsDirectory}. Install the plugin first.`);
  }

  matches.sort();
  return matches[0];
}

function renderShim({ sourceExtension, fallbackExtension }) {
  if (!fallbackExtension || fallbackExtension === sourceExtension) {
    return `import { pathToFileURL } from "node:url";\n\nawait import(pathToFileURL(${JSON.stringify(sourceExtension)}).href);\n`;
  }

  return [
    "import fs from \"node:fs\";",
    "import path from \"node:path\";",
    "import { pathToFileURL } from \"node:url\";",
    "",
    `const extensionRelativePath = ${JSON.stringify(extensionRelativePath)};`,
    `const preferredExtension = ${JSON.stringify(sourceExtension)};`,
    `const fallbackExtension = ${JSON.stringify(fallbackExtension)};`,
    "",
    "if (!findWorkspaceExtension(process.cwd())) {",
    "  const resolvedExtension = fs.existsSync(preferredExtension) ? preferredExtension : fallbackExtension;",
    "  await import(pathToFileURL(resolvedExtension).href);",
    "}",
    "",
    "function findWorkspaceExtension(startDirectory) {",
    "  let current = path.resolve(startDirectory);",
    "  while (true) {",
    "    const candidate = path.join(current, extensionRelativePath);",
    "    if (fs.existsSync(candidate)) {",
    "      return candidate;",
    "    }",
    "    const parent = path.dirname(current);",
    "    if (parent === current) {",
    "      return undefined;",
    "    }",
    "    current = parent;",
    "  }",
    "}",
    ""
  ].join("\n");
}

function isSameOrDescendantPath(targetPath, parentPath) {
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedParent = normalizePathForComparison(parentPath);
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}${path.sep}`);
}

function normalizePathForComparison(targetPath) {
  const normalized = path.resolve(targetPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
