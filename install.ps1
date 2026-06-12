[CmdletBinding()]
param(
  [string]$PluginSource = $(if ($env:COPILOT_COST_PLUGIN_SOURCE) { $env:COPILOT_COST_PLUGIN_SOURCE } else { "DamianEdwards/copilot-cli-cost" }),
  [string]$MarketplaceName = $(if ($env:COPILOT_COST_MARKETPLACE_NAME) { $env:COPILOT_COST_MARKETPLACE_NAME } else { "copilot-cli-cost-marketplace" }),
  [string]$PluginName = $(if ($env:COPILOT_COST_PLUGIN_NAME) { $env:COPILOT_COST_PLUGIN_NAME } else { "copilot-cli-cost" }),
  [string]$InstallBaseUrl = $(if ($env:COPILOT_COST_INSTALL_BASE_URL) { $env:COPILOT_COST_INSTALL_BASE_URL } else { "https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main" }),
  [Alias("CopilotHome")]
  [string]$CopilotHomePath = $(if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { "" }),
  [switch]$Uninstall,
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
  $localConfigureScript = Get-LocalInstallerScript "configure-install.mjs"
  $localLauncherScript = Get-LocalInstallerScript "statusline-launcher.mjs"
  if ($localConfigureScript -and $localLauncherScript) {
    Write-Host "Using local installer helper at $localConfigureScript."
    return $localConfigureScript
  }

  $remoteConfigureScript = Get-RemoteInstallerScript "configure-install.mjs"
  $remoteLauncherScript = Get-RemoteInstallerScript "statusline-launcher.mjs"
  $remoteConfigureUrl = "$($InstallBaseUrl.TrimEnd('/'))/scripts/configure-install.mjs"
  $remoteLauncherUrl = "$($InstallBaseUrl.TrimEnd('/'))/scripts/statusline-launcher.mjs"

  Write-Host "Downloading installer helper from $remoteConfigureUrl..."
  Invoke-WebRequest -Uri $remoteConfigureUrl -OutFile $remoteConfigureScript
  Invoke-WebRequest -Uri $remoteLauncherUrl -OutFile $remoteLauncherScript

  return $remoteConfigureScript
}

function Get-LocalInstallerScript {
  param([string]$Name)

  if (-not $PSScriptRoot) {
    return $null
  }

  $candidate = Join-Path (Join-Path $PSScriptRoot "scripts") $Name
  if (Test-Path -Path $candidate -PathType Leaf) {
    return [System.IO.Path]::GetFullPath($candidate)
  }

  return $null
}

function Get-InstallerScript {
  param([string]$Name)

  $localScript = Get-LocalInstallerScript $Name
  if ($localScript) {
    Write-Host "Using local installer helper at $localScript."
    return $localScript
  }

  $remoteScript = Get-RemoteInstallerScript $Name
  $remoteUrl = "$($InstallBaseUrl.TrimEnd('/'))/scripts/$Name"
  Write-Host "Downloading installer helper from $remoteUrl..."
  Invoke-WebRequest -Uri $remoteUrl -OutFile $remoteScript
  return $remoteScript
}

function Get-RemoteInstallerScript {
  param([string]$Name)

  if (-not $script:temporaryConfigureDirectory) {
    $script:temporaryConfigureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "copilot-cli-cost-install-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $script:temporaryConfigureDirectory | Out-Null
  }

  return Join-Path $script:temporaryConfigureDirectory $Name
}

function Get-CopilotVersionParts {
  $versionText = (& copilot --version 2>$null) -join " "
  if ($versionText -match "(\d+)\.(\d+)\.(\d+)(?:-(\d+))?") {
    $preRelease = if ($matches[4]) { [int]$matches[4] } else { [int]::MaxValue }
    return @([int]$matches[1], [int]$matches[2], [int]$matches[3], $preRelease)
  }
  return $null
}

function Test-VersionAtLeast {
  param(
    [int[]]$Current,
    [int[]]$Minimum
  )

  if (-not $Current) {
    return $false
  }

  for ($index = 0; $index -lt $Minimum.Length; $index++) {
    if ($Current[$index] -gt $Minimum[$index]) {
      return $true
    }
    if ($Current[$index] -lt $Minimum[$index]) {
      return $false
    }
  }
  return $true
}

function Test-CopilotSupportsMarketplaceInstall {
  return (Test-VersionAtLeast -Current (Get-CopilotVersionParts) -Minimum @(1, 0, 56, 0))
}

function Test-PluginInstalled {
  param(
    [string]$PluginList,
    [string]$Name
  )

  $escapedName = [regex]::Escape($Name)
  return $PluginList -match "(?im)^\s*\S+\s+$escapedName\s+\(v"
}

function Test-MarketplaceRegistered {
  param(
    [string]$MarketplaceList,
    [string]$Name
  )

  $escapedName = [regex]::Escape($Name)
  return $MarketplaceList -match "(?im)^\s*\S+\s+$escapedName\s+\("
}

function Initialize-PluginMarketplace {
  param(
    [string]$Source,
    [string]$Name
  )

  $marketplaceList = (& copilot plugin marketplace list 2>$null) -join "`n"
  if (Test-MarketplaceRegistered $marketplaceList $Name) {
    Invoke-Checked "copilot" @("plugin", "marketplace", "update", $Name)
  } else {
    Invoke-Checked "copilot" @("plugin", "marketplace", "add", $Source)
  }
}

function Uninstall-PluginIfInstalled {
  param(
    [string]$PluginList,
    [string]$Name
  )

  if (Test-PluginInstalled $PluginList $Name) {
    Write-Host "Uninstalling Copilot CLI Cost plugin $Name..."
    Invoke-Checked "copilot" @("plugin", "uninstall", $Name)
    return $true
  }

  return $false
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

  if ($Uninstall) {
    Write-Host "Uninstalling Copilot CLI Cost..."
    $configureScript = Get-ConfigureScript
    $shimScript = Get-InstallerScript "install-extension-shim.mjs"

    Invoke-Checked "node" @($configureScript, "--uninstall", "--platform", "windows", "--copilot-home", $resolvedCopilotHome)
    Invoke-Checked "node" @($shimScript, "--uninstall", "--copilot-home", $resolvedCopilotHome)

    $pluginList = (& copilot plugin list 2>$null) -join "`n"
    $removedMarketplacePlugin = Uninstall-PluginIfInstalled $pluginList "$PluginName@$MarketplaceName"
    if ($removedMarketplacePlugin) {
      $pluginList = (& copilot plugin list 2>$null) -join "`n"
    }
    $removedDirectPlugin = Uninstall-PluginIfInstalled $pluginList $PluginName
    if (-not $removedMarketplacePlugin -and -not $removedDirectPlugin) {
      Write-Host "Copilot CLI Cost plugin was not installed."
    }

    Write-Host ""
    Write-Host "Uninstall complete. Restart active Copilot CLI sessions to unload any extension instance that was already running."
    return
  }

  Write-Host "Installing or updating Copilot CLI Cost plugin..."
  $pluginList = (& copilot plugin list 2>$null) -join "`n"
  if (Test-CopilotSupportsMarketplaceInstall) {
    $marketplacePlugin = "$PluginName@$MarketplaceName"
    Initialize-PluginMarketplace $PluginSource $MarketplaceName
    $pluginList = (& copilot plugin list 2>$null) -join "`n"
    $hasMarketplacePlugin = Test-PluginInstalled $pluginList $marketplacePlugin
    $hasDirectPlugin = Test-PluginInstalled $pluginList $PluginName

    if ($hasDirectPlugin) {
      Write-Host "Removing deprecated direct Copilot CLI Cost plugin install..."
      Invoke-Checked "copilot" @("plugin", "uninstall", $PluginName)
    }

    if ($hasMarketplacePlugin) {
      Invoke-Checked "copilot" @("plugin", "update", $marketplacePlugin)
    } else {
      Write-Host "Installing Copilot CLI Cost plugin from $marketplacePlugin..."
      Invoke-Checked "copilot" @("plugin", "install", $marketplacePlugin)
    }
  } elseif (Test-PluginInstalled $pluginList $PluginName) {
    Invoke-Checked "copilot" @("plugin", "update", $PluginName)
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
