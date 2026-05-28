[CmdletBinding()]
param(
  [string]$PluginSource = $(if ($env:COPILOT_COST_PLUGIN_SOURCE) { $env:COPILOT_COST_PLUGIN_SOURCE } else { "DamianEdwards/copilot-cli-cost" }),
  [string]$InstallBaseUrl = $(if ($env:COPILOT_COST_INSTALL_BASE_URL) { $env:COPILOT_COST_INSTALL_BASE_URL } else { "https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main" }),
  [Alias("CopilotHome")]
  [string]$CopilotHomePath = $(if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { "" }),
  [switch]$SkipStatusLine,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$temporaryConfigureDirectory = $null

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

function Get-ConfigureScript {
  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "copilot-cli-cost-install-$([guid]::NewGuid())"
  $script:temporaryConfigureDirectory = $temporaryDirectory
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $remoteConfigureScript = Join-Path $temporaryDirectory "configure-install.mjs"
  $remoteUrl = "$($InstallBaseUrl.TrimEnd('/'))/scripts/configure-install.mjs"

  Write-Host "Downloading installer helper from $remoteUrl..."
  Invoke-WebRequest -Uri $remoteUrl -OutFile $remoteConfigureScript

  return $remoteConfigureScript
}

$previousCopilotHome = $env:COPILOT_HOME
try {
  Require-Command "copilot"
  Require-Command "node"

  if (-not $CopilotHomePath) {
    $CopilotHomePath = Join-Path (Get-UserHome) ".copilot"
  }
  $resolvedCopilotHome = [System.IO.Path]::GetFullPath($CopilotHomePath)
  $env:COPILOT_HOME = $resolvedCopilotHome
  $installedPlugins = Join-Path $resolvedCopilotHome "installed-plugins"

  Write-Host "Installing or updating Copilot CLI Cost plugin..."
  $pluginList = (& copilot plugin list 2>$null) -join "`n"
  if ($pluginList -match "(?i)\bcopilot-cli-cost\b") {
    Invoke-Checked "copilot" @("plugin", "update", "copilot-cli-cost")
  } else {
    Write-Host "Installing Copilot CLI Cost plugin from $PluginSource..."
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
  Invoke-Checked "node" @($installer.FullName, "--copilot-home", $resolvedCopilotHome)

  $configureScript = Get-ConfigureScript
  $configureArgs = @($configureScript, "--platform", "windows", "--copilot-home", $resolvedCopilotHome)
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
} finally {
  if ($temporaryConfigureDirectory -and (Test-Path $temporaryConfigureDirectory)) {
    Remove-Item -Recurse -Force $temporaryConfigureDirectory
  }
  if ($null -eq $previousCopilotHome) {
    Remove-Item Env:COPILOT_HOME -ErrorAction SilentlyContinue
  } else {
    $env:COPILOT_HOME = $previousCopilotHome
  }
}
