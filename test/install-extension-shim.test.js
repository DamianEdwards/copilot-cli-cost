import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceInstaller = path.join(repoRoot, "scripts", "install-extension-shim.mjs");
const sourceExtension = path.join(repoRoot, ".github", "extensions", "copilot-cli-cost", "extension.mjs");

test("source checkout installer uses the installed plugin extension", () => {
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-shim-home-"));
  const installedExtension = path.join(
    copilotHome,
    "installed-plugins",
    "_direct",
    "DamianEdwards--copilot-cli-cost",
    ".github",
    "extensions",
    "copilot-cli-cost",
    "extension.mjs"
  );

  fs.mkdirSync(path.dirname(installedExtension), { recursive: true });
  fs.writeFileSync(installedExtension, "export {};\n");

  const result = spawnSync(process.execPath, [sourceInstaller, "--copilot-home", copilotHome], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const shimPath = path.join(copilotHome, "extensions", "copilot-cli-cost", "extension.mjs");
  const shim = fs.readFileSync(shimPath, "utf8");
  assert.ok(shim.includes(JSON.stringify(installedExtension)), "shim should point at the installed plugin extension");
  assert.ok(!shim.includes(JSON.stringify(sourceExtension)), "source-checkout flow should not pin to the source checkout");
  assert.ok(!shim.includes("findWorkspaceExtension"), "shim should rely on Copilot CLI for repo-local extension precedence");
  assert.ok(!shim.includes("extensionRelativePath"), "shim should not contain workspace-extension lookup logic");
});

test("installed plugin installer keeps the installed plugin extension", () => {
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-shim-home-"));
  const installedPluginRoot = path.join(
    copilotHome,
    "installed-plugins",
    "_direct",
    "DamianEdwards--copilot-cli-cost"
  );
  const installedExtension = path.join(installedPluginRoot, ".github", "extensions", "copilot-cli-cost", "extension.mjs");
  const installedInstaller = path.join(installedPluginRoot, "scripts", "install-extension-shim.mjs");

  fs.mkdirSync(path.dirname(installedExtension), { recursive: true });
  fs.mkdirSync(path.dirname(installedInstaller), { recursive: true });
  fs.writeFileSync(installedExtension, "export {};\n");
  fs.copyFileSync(sourceInstaller, installedInstaller);

  const result = spawnSync(process.execPath, [installedInstaller, "--copilot-home", copilotHome], {
    cwd: installedPluginRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const shimPath = path.join(copilotHome, "extensions", "copilot-cli-cost", "extension.mjs");
  const shim = fs.readFileSync(shimPath, "utf8");
  assert.ok(shim.includes(JSON.stringify(installedExtension)), "shim should point at the installed plugin extension");
  assert.ok(!shim.includes(JSON.stringify(sourceExtension)), "installed-plugin flow should not pin to the source checkout");
  assert.ok(!shim.includes("findWorkspaceExtension"), "shim should rely on Copilot CLI for repo-local extension precedence");
});

test("installer requires an installed plugin copy", () => {
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-shim-home-"));

  const result = spawnSync(process.execPath, [sourceInstaller, "--copilot-home", copilotHome], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run install\.ps1\/install\.sh first/);
});
