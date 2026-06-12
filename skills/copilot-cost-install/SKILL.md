---
name: copilot-cost-install
description: Enable the Copilot CLI Cost /cost command, app canvas, and panel by installing the user-scoped SDK extension shim that imports the installed plugin.
---

Use this skill when the user asks to install, enable, set up, or repair the Copilot CLI Cost `/cost` command, Session Cost canvas, or cost panel after installing the plugin.

Goal:

- Locate the installed `copilot-cli-cost` plugin under the user's Copilot installed plugins directory.
- Run the plugin's deterministic shim installer script. The shim imports the installed plugin copy; Copilot CLI handles repo-local extension precedence when running inside a checkout.
- Tell GitHub Copilot app users to start a new app session or restart/reload the app so it discovers the updated user extension shim. Tell interactive `copilot` CLI users to use `/extensions` only if they need to inspect or reload the extension.

Use the command for the user's shell.

PowerShell:

```powershell
$installer = Get-ChildItem "$env:USERPROFILE\.copilot\installed-plugins" -Directory -Recurse |
  Where-Object { Test-Path (Join-Path $_.FullName "scripts\install-extension-shim.mjs") } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $installer) {
  throw "Could not find the installed copilot-cli-cost plugin. Run install.ps1 or install.sh first."
}

node (Join-Path $installer "scripts\install-extension-shim.mjs")
```

Bash/zsh:

```bash
installer="$(find "$HOME/.copilot/installed-plugins" -type f -path '*/scripts/install-extension-shim.mjs' | head -n 1)"
if [ -z "$installer" ]; then
  echo "Could not find the installed copilot-cli-cost plugin. Run install.ps1 or install.sh first." >&2
  exit 1
fi
node "$installer"
```

After the script succeeds, instruct the user:

1. In the GitHub Copilot app, start a new app session or restart/reload the app so it discovers the updated user extension shim.
2. In the interactive `copilot` CLI, run `/extensions` only if you need to inspect or reload `copilot-cli-cost` under **User**.
3. Run `/cost help` in the CLI to confirm the command is available, or open the **Session Cost** canvas in the GitHub Copilot app for the side-panel view.

Do not overwrite unrelated user extensions. If the installer reports that it refused to overwrite an existing non-Copilot-Cost extension, stop and explain that the user already has a user extension named `copilot-cli-cost`.
