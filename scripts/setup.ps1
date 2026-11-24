<#
.SYNOPSIS
    One-time (and safe to repeat) local setup for the marketplace on Windows.

.DESCRIPTION
    1. Checks Node.js, pnpm and Docker Desktop.
    2. Creates .env from .env.example if it does not exist, or adds settings that newer
       versions introduced (existing values are never changed).
    3. Installs dependencies with pnpm.
    4. Starts PostgreSQL, Redis, MinIO and Mailpit with docker compose.
    5. Applies database migrations and seeds reference data.
    6. Builds the shared packages.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
#>
[CmdletBinding()]
param()

. "$PSScriptRoot/lib/common.ps1"
Set-Location $script:RepoRoot

Write-Step 'Checking prerequisites'

if (-not (Test-CommandExists 'node')) {
    Stop-WithError 'Node.js is not installed. Install Node.js 24 LTS (see docs/windows-setup.md).'
}
$nodeVersion = (node --version).TrimStart('v')
$nodeParts = $nodeVersion.Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 22)) {
    Stop-WithError "Node.js $nodeVersion is too old. Install Node.js 24 LTS (22.22+ also works)."
}
Write-Ok "Node.js $nodeVersion"

if (-not (Test-CommandExists 'pnpm')) {
    # npm installs global tools into %APPDATA%\npm, which needs no administrator rights.
    # ('corepack enable' writes into C:\Program Files\nodejs and fails without them.)
    Write-Warn 'pnpm not found. Installing pnpm 10.28.0 with npm (no administrator rights needed)...'
    Invoke-Checked 'npm' @('install', '--global', 'pnpm@10.28.0')
    # Make the new command visible in this session without reopening PowerShell.
    $npmPrefix = (npm prefix --global).Trim()
    if ($npmPrefix -and ($env:Path -notlike "*$npmPrefix*")) { $env:Path = "$npmPrefix;$env:Path" }
    if (-not (Test-CommandExists 'pnpm')) {
        Stop-WithError 'pnpm was installed but is not on PATH. Close and reopen PowerShell, then run setup.ps1 again.'
    }
}
Write-Ok "pnpm $(pnpm --version)"

Assert-DockerRunning
Write-Ok 'Docker Desktop is running'

Write-Step 'Preparing environment file'
if (Test-Path '.env') {
    # Later phases add settings; copy only the missing ones so local values are kept.
    $existing = Read-DotEnv
    $missing = @()
    foreach ($line in Get-Content '.env.example') {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=' -and -not $existing.ContainsKey($Matches[1])) {
            $missing += $line
        }
    }
    if ($missing.Count -gt 0) {
        $stamp = Get-Date -Format 'yyyy-MM-dd'
        Add-Content -Path '.env' -Value (@('', "# Added by setup.ps1 from .env.example on $stamp") + $missing)
        $names = ($missing | ForEach-Object { ($_ -split '=', 2)[0].Trim() }) -join ', '
        Write-Ok "Added new settings to .env: $names"
    }
    else {
        Write-Ok '.env already has every setting (left unchanged)'
    }
}
else {
    Copy-Item '.env.example' '.env'
    Write-Ok 'Created .env from .env.example'
}

Write-Step 'Installing dependencies (pnpm install)'
Invoke-Checked 'pnpm' @('install')

Start-Infrastructure

Write-Step 'Applying database migrations'
Invoke-Checked 'pnpm' @('db:deploy')

Write-Step 'Seeding reference data'
Invoke-Checked 'pnpm' @('db:seed')

Write-Step 'Building shared packages'
Invoke-Checked 'pnpm' @('build:packages')

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host 'Start everything with:  .\scripts\start.ps1'
Write-Host '  Storefront     http://localhost:5173'
Write-Host '  Seller portal  http://localhost:5174'
Write-Host '  Admin portal   http://localhost:5175'
Write-Host '  API + Swagger  http://localhost:3000/api/docs'
Write-Host '  MinIO console  http://localhost:9001'
Write-Host '  Mailpit        http://localhost:8025'
Write-Host 'Stop the Docker services with:  .\scripts\stop.ps1'
