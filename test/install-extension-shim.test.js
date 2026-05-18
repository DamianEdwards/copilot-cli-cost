import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceInstaller = path.join(repoRoot, "scripts", "install-extension-shim.mjs");
const sourceExtension = path.join(repoRoot, ".github", "extensions", "copilot-cli-cost", "extension.mjs");

test("source checkout installer prefers the checkout extension", () => {
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
  assert.ok(shim.includes(JSON.stringify(sourceExtension)), "shim should prefer the source checkout extension");
  assert.ok(shim.includes(JSON.stringify(installedExtension)), "shim should retain the installed plugin as a fallback");
  assert.ok(shim.includes("findWorkspaceExtension(process.cwd())"), "shim should defer to a project extension in the current workspace");
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
});
