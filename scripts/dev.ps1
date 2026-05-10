Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AiServiceDir = Join-Path $RootDir "services/ai-service"
$DesktopAppDir = Join-Path $RootDir "apps/desktop-app"

$AiServicePort = if ($env:AI_SERVICE_PORT) { $env:AI_SERVICE_PORT } else { "3001" }
$AiServiceUrl = if ($env:VITE_AI_SERVICE_URL) { $env:VITE_AI_SERVICE_URL } else { "http://localhost:$AiServicePort" }
$ChromaHost = if ($env:CHROMA_HOST) { $env:CHROMA_HOST } else { "localhost" }
$ChromaPort = if ($env:CHROMA_PORT) { $env:CHROMA_PORT } else { "8000" }
$VitePort = if ($env:VITE_PORT) { $env:VITE_PORT } else { "5173" }
$StartChroma = if ($env:START_CHROMA) { $env:START_CHROMA } else { "1" }
$DevKillPorts = if ($env:DEV_KILL_PORTS) { $env:DEV_KILL_PORTS } else { "1" }
$DevWaitSeconds = if ($env:DEV_WAIT_SECONDS) { [int]$env:DEV_WAIT_SECONDS } else { 180 }

$script:IsWindowsHost = $env:OS -eq "Windows_NT"
$script:Processes = New-Object "System.Collections.Generic.List[System.Diagnostics.Process]"
$script:ExitCode = 0
$script:ReportedFailure = $false

function Write-DevLog {
  param([string]$Message)
  Write-Host "[dev] $Message" -ForegroundColor Cyan
}

function Write-DevWarning {
  param([string]$Message)
  Write-Host "[dev] $Message" -ForegroundColor Yellow
}

function Write-DevError {
  param([string]$Message)
  Write-Host "[dev] $Message" -ForegroundColor Red
}

function Fail {
  param([string]$Message)
  $script:ReportedFailure = $true
  Write-DevError $Message
  throw $Message
}

function Resolve-CommandPath {
  param([string]$Name)

  $candidates = @($Name)
  if ($script:IsWindowsHost) {
    $candidates = @("$Name.exe", "$Name.cmd", "$Name.bat", $Name)
  }

  foreach ($candidate in $candidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
      continue
    }

    $sourceProperty = $command.PSObject.Properties["Source"]
    if ($sourceProperty -and $sourceProperty.Value) {
      return $sourceProperty.Value
    }

    $pathProperty = $command.PSObject.Properties["Path"]
    if ($pathProperty -and $pathProperty.Value) {
      return $pathProperty.Value
    }
  }

  return $null
}

function Require-Command {
  param([string]$Name)

  $commandPath = Resolve-CommandPath $Name
  if (-not $commandPath) {
    Fail "$Name is required but was not found."
  }

  return $commandPath
}

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = $null

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(1000)) {
      return $false
    }

    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) {
      $client.Close()
    }
  }
}

function Test-UrlUp {
  param([string]$Url)

  $response = $null

  try {
    $request = [System.Net.WebRequest]::Create($Url)
    $request.Method = "GET"
    $request.Timeout = 5000
    $response = $request.GetResponse()
    return $true
  } catch {
    return $false
  } finally {
    if ($response) {
      $response.Close()
    }
  }
}

function Get-PortProcessIds {
  param([int]$Port)

  $ids = @()

  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $ids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } elseif (Resolve-CommandPath "netstat") {
    $ids = netstat -ano -p tcp |
      Select-String "LISTENING" |
      ForEach-Object {
        $parts = ($_ -split "\s+") | Where-Object { $_ }
        if ($parts.Count -ge 5 -and $parts[1] -match ":$Port$") {
          $parts[$parts.Count - 1]
        }
      } |
      Select-Object -Unique
  }

  return @($ids | Where-Object { $_ } | Select-Object -Unique)
}

function Stop-PortIfNeeded {
  param(
    [int]$Port,
    [string]$Name
  )

  $ids = @(Get-PortProcessIds $Port)
  if ($ids.Count -eq 0) {
    return
  }

  Write-DevWarning "Killing stale $Name process(es) on port ${Port}: $($ids -join ', ')"
  foreach ($id in $ids) {
    try {
      Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }

  Start-Sleep -Seconds 1
}

function Clear-StaleAppPorts {
  if ($DevKillPorts -eq "0") {
    return
  }

  Stop-PortIfNeeded ([int]$AiServicePort) "AI service"
  Stop-PortIfNeeded ([int]$VitePort) "Vite"
}

function Wait-ForPort {
  param(
    [string]$HostName,
    [int]$Port,
    [string]$Name
  )

  for ($attempt = 0; $attempt -lt $DevWaitSeconds; $attempt++) {
    if (Test-PortOpen $HostName $Port) {
      Write-DevLog "$Name is ready on ${HostName}:$Port"
      return
    }

    Start-Sleep -Seconds 1
  }

  Fail "$Name did not become ready on ${HostName}:$Port."
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [string]$Name
  )

  for ($attempt = 0; $attempt -lt $DevWaitSeconds; $attempt++) {
    if (Test-UrlUp $Url) {
      Write-DevLog "$Name is ready"
      return
    }

    Start-Sleep -Seconds 1
  }

  Fail "$Name did not become ready at $Url."
}

function Invoke-ExternalCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  return $LASTEXITCODE
}

function Install-DependenciesIfNeeded {
  param(
    [string]$Directory,
    [string]$Name
  )

  if (Test-Path (Join-Path $Directory "node_modules") -PathType Container) {
    return
  }

  $npm = Require-Command "npm"
  Write-DevLog "Installing $Name dependencies..."

  $packageLock = Join-Path $Directory "package-lock.json"
  if (Test-Path $packageLock -PathType Leaf) {
    $exitCode = Invoke-ExternalCommand $npm @("--prefix", $Directory, "ci")
    if ($exitCode -eq 0) {
      return
    }
  }

  $exitCode = Invoke-ExternalCommand $npm @("--prefix", $Directory, "install")
  if ($exitCode -ne 0) {
    Fail "npm install failed for $Name."
  }
}

function Start-ManagedProcess {
  param(
    [string]$CommandName,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory
  )

  $commandPath = Require-Command $CommandName
  $process = Start-Process `
    -FilePath $commandPath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -PassThru `
    -NoNewWindow

  $script:Processes.Add($process) | Out-Null
  return $process
}

function Stop-DevProcesses {
  if ($script:Processes.Count -eq 0) {
    return
  }

  Write-DevLog "Stopping local dev processes..."

  foreach ($process in $script:Processes) {
    try {
      if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
    }
  }

  foreach ($process in $script:Processes) {
    try {
      $process.WaitForExit(5000) | Out-Null
    } catch {
    }
  }
}

function Start-Chroma {
  if (Test-PortOpen $ChromaHost ([int]$ChromaPort)) {
    Write-DevLog "Chroma is already running on ${ChromaHost}:$ChromaPort"
    return
  }

  if ($StartChroma -eq "0") {
    Write-DevWarning "START_CHROMA=0 and Chroma is not reachable on ${ChromaHost}:$ChromaPort"
    return
  }

  if (Resolve-CommandPath "chroma") {
    Write-DevLog "Starting Chroma with the local chroma CLI..."
    Start-ManagedProcess "chroma" @("run", "--path", "./data/chroma", "--host", $ChromaHost, "--port", $ChromaPort) $AiServiceDir | Out-Null
    Wait-ForPort $ChromaHost ([int]$ChromaPort) "Chroma"
    return
  }

  if (Resolve-CommandPath "docker") {
    Write-DevLog "Starting Chroma with Docker..."
    Start-ManagedProcess "docker" @("run", "--rm", "-p", "$($ChromaPort):8000", "chromadb/chroma") $RootDir | Out-Null
    Wait-ForPort $ChromaHost ([int]$ChromaPort) "Chroma"
    return
  }

  Fail "Chroma is not running. Install Docker or the chroma CLI, or start Chroma manually on port $ChromaPort."
}

function Start-AiService {
  if (Test-UrlUp "$AiServiceUrl/health") {
    Write-DevLog "AI service is already running at $AiServiceUrl"
    return
  }

  if (Test-PortOpen "localhost" ([int]$AiServicePort)) {
    Fail "Port $AiServicePort is already in use, but $AiServiceUrl/health is not responding."
  }

  Write-DevLog "Starting AI service..."
  $previousPort = $env:PORT
  $env:PORT = $AiServicePort

  try {
    Start-ManagedProcess "npm" @("start") $AiServiceDir | Out-Null
  } finally {
    if ($null -eq $previousPort) {
      Remove-Item Env:\PORT -ErrorAction SilentlyContinue
    } else {
      $env:PORT = $previousPort
    }
  }

  Wait-ForUrl "$AiServiceUrl/health" "AI service"
}

function Start-DesktopApp {
  Write-DevLog "Starting desktop app..."

  $previousServiceUrl = $env:VITE_AI_SERVICE_URL
  $env:VITE_AI_SERVICE_URL = $AiServiceUrl

  try {
    $desktopProcess = Start-ManagedProcess "npm" @("run", "dev") $DesktopAppDir
  } finally {
    if ($null -eq $previousServiceUrl) {
      Remove-Item Env:\VITE_AI_SERVICE_URL -ErrorAction SilentlyContinue
    } else {
      $env:VITE_AI_SERVICE_URL = $previousServiceUrl
    }
  }

  Wait-Process -Id $desktopProcess.Id
  $desktopProcess.Refresh()

  if ($desktopProcess.ExitCode -ne 0) {
    $script:ExitCode = $desktopProcess.ExitCode
  }
}

try {
  Require-Command "npm" | Out-Null

  Install-DependenciesIfNeeded $AiServiceDir "AI service"
  Install-DependenciesIfNeeded $DesktopAppDir "desktop app"

  Clear-StaleAppPorts
  Start-Chroma

  if (-not $env:OPENROUTER_API_KEY) {
    Write-DevWarning "OPENROUTER_API_KEY is not set. The app can index and edit files, but AI generation will fail until it is provided."
  }

  Start-AiService
  Start-DesktopApp
} catch {
  if (-not $script:ReportedFailure) {
    Write-DevError $_.Exception.Message
  }

  if ($script:ExitCode -eq 0) {
    $script:ExitCode = 1
  }
} finally {
  Stop-DevProcesses
}

exit $script:ExitCode
