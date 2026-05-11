[CmdletBinding()]
param(
  [string]$PluginSource = $(if ($env:COPILOT_COST_PLUGIN_SOURCE) { $env:COPILOT_COST_PLUGIN_SOURCE } else { "DamianEdwards/copilot-cli-cost" }),
  [switch]$SkipStatusLine,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-Checked {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
  }
}

function Get-UserHome {
  if ($env:USERPROFILE) {
    return $env:USERPROFILE
  }
  return [Environment]::GetFolderPath("UserProfile")
}

Require-Command "copilot"
Require-Command "node"

$userHome = Get-UserHome
$installedPlugins = Join-Path $userHome ".copilot\installed-plugins"

Write-Host "Installing Copilot CLI Cost plugin from $PluginSource..."
$pluginList = (& copilot plugin list 2>$null) -join "`n"
if ($pluginList -match "(?i)\bcopilot-cli-cost\b") {
  Write-Host "Copilot CLI Cost plugin is already installed."
} else {
  Invoke-Checked "copilot" @("plugin", "install", $PluginSource)
}

$installer = Get-ChildItem $installedPlugins -Recurse -Filter "install-extension-shim.mjs" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*copilot-cli-cost*scripts\install-extension-shim.mjs" } |
  Sort-Object FullName |
  Select-Object -First 1

if (-not $installer) {
  throw "Could not find the installed copilot-cli-cost plugin under $installedPlugins."
}

Write-Host "Installing Copilot Cost extension shim..."
Invoke-Checked "node" @($installer.FullName)

$configureScript = Join-Path $PSScriptRoot "scripts\configure-install.mjs"
$configureArgs = @($configureScript, "--platform", "windows")
if ($SkipStatusLine) {
  $configureArgs += "--skip-statusline"
}
if ($Yes) {
  $configureArgs += "--yes"
}

Write-Host "Configuring Copilot experimental features and status line..."
Invoke-Checked "node" $configureArgs

Write-Host ""
Write-Host "Install complete. If /cost is not available in an active Copilot CLI session, run /extensions and enable copilot-cli-cost under User."
