#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fallbackStatusline = path.resolve(scriptDirectory, "..", "src", "cli", "statusline.js");

main();

function main() {
  const raw = readStdin();
  const payload = parsePayload(raw);
  const statuslineScript = findWorkspaceStatusline(payload) ?? fallbackStatusline;
  const result = spawnSync(process.execPath, [statuslineScript, ...process.argv.slice(2)], {
    encoding: "utf8",
    input: raw,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr && process.env.COPILOT_COST_STATUSLINE_DEBUG === "true") {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    debug(`statusline launcher failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 0;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  if (!raw.trim()) {
    return {};
  }
  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch (error) {
    debug(`could not parse statusline payload: ${error.message}`);
    return {};
  }
}

function findWorkspaceStatusline(payload) {
  if (process.env.COPILOT_COST_STATUSLINE_DISABLE_WORKSPACE === "true") {
    return undefined;
  }

  for (const startDirectory of candidateStartDirectories(payload)) {
    const repositoryRoot = findRepositoryRoot(startDirectory);
    if (!repositoryRoot) {
      continue;
    }

    const candidate = path.join(repositoryRoot, "src", "cli", "statusline.js");
    if (path.resolve(candidate) !== path.resolve(fallbackStatusline) && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function candidateStartDirectories(payload) {
  const candidates = [
    payload.workspace?.current_dir,
    payload.cwd,
    process.cwd()
  ];
  return candidates
    .filter((candidate) => typeof candidate === "string" && candidate.trim())
    .map((candidate) => path.resolve(candidate));
}

function findRepositoryRoot(startDirectory) {
  let current = fs.existsSync(startDirectory) && fs.statSync(startDirectory).isFile()
    ? path.dirname(startDirectory)
    : startDirectory;
  while (current && current !== path.dirname(current)) {
    if (isCopilotCostRepository(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
}

function isCopilotCostRepository(directory) {
  const packagePath = path.join(directory, "package.json");
  const statuslinePath = path.join(directory, "src", "cli", "statusline.js");
  if (!fs.existsSync(packagePath) || !fs.existsSync(statuslinePath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return packageJson.name === "copilot-cli-cost";
  } catch {
    return false;
  }
}

function debug(message) {
  if (process.env.COPILOT_COST_STATUSLINE_DEBUG === "true") {
    process.stderr.write(`copilot-cost-statusline: ${message}\n`);
  }
}
