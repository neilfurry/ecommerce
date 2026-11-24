# Shared helpers for the development scripts. Dot-source this file:
#   . "$PSScriptRoot/lib/common.ps1"
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.

$ErrorActionPreference = 'Stop'

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    [ok] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "    [warn] $Message" -ForegroundColor Yellow
}

function Stop-WithError([string]$Message) {
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# Runs a native command and stops the script if it fails (PowerShell 5.1 does not do this).
function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$Arguments = @()
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
    }
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Reads KEY=VALUE pairs from the repository-root .env file into a hashtable.
function Read-DotEnv {
    $path = Join-Path $script:RepoRoot '.env'
    $values = @{}
    if (-not (Test-Path $path)) { return $values }
    foreach ($line in Get-Content $path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { continue }
        $key = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
        $values[$key] = $value
    }
    return $values
}

function Get-EnvValue([hashtable]$Env, [string]$Key, [string]$Default) {
    if ($Env.ContainsKey($Key) -and $Env[$Key] -ne '') { return $Env[$Key] }
    return $Default
}

function Assert-DockerRunning {
    if (-not (Test-CommandExists 'docker')) {
        Stop-WithError 'Docker is not installed. Install Docker Desktop (see docs/windows-setup.md).'
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError 'Docker Desktop is not running. Start it, wait for "Engine running", then retry.'
    }
}

# Arguments for docker compose: the file lives in docker/ and values come from the root .env.
function Get-ComposeArgs([string[]]$Arguments) {
    $base = @('compose', '--env-file', (Join-Path $script:RepoRoot '.env'), '-f', (Join-Path $script:RepoRoot 'docker/docker-compose.yml'))
    return $base + $Arguments
}

function Start-Infrastructure {
    Write-Step 'Starting PostgreSQL, Redis, MinIO and Mailpit (docker compose)'
    Assert-DockerRunning
    Push-Location $script:RepoRoot
    try {
        Invoke-Checked 'docker' (Get-ComposeArgs @('up', '-d', '--wait'))
    }
    finally {
        Pop-Location
    }
    Write-Ok 'Infrastructure is running'
}
