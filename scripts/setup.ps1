<#
.SYNOPSIS
    One-time (and safe to repeat) local setup for the marketplace on Windows.

.DESCRIPTION
    1. Checks Node.js, pnpm and Docker Desktop.
    2. Creates .env from .env.example if it does not exist.
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
    Write-Warn 'pnpm not found. Enabling it through Corepack...'
    Invoke-Checked 'corepack' @('enable')
    Invoke-Checked 'corepack' @('prepare', 'pnpm@10.28.0', '--activate')
}
Write-Ok "pnpm $(pnpm --version)"

Assert-DockerRunning
Write-Ok 'Docker Desktop is running'

Write-Step 'Preparing environment file'
if (Test-Path '.env') {
    Write-Ok '.env already exists (left unchanged)'
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
