<#
.SYNOPSIS
    Starts the infrastructure and every app (API, worker, three frontends) with hot reload.

.PARAMETER Only
    Start a single app instead of all: api, worker, storefront, seller, admin.

.EXAMPLE
    .\scripts\dev.ps1
    .\scripts\dev.ps1 -Only api
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'api', 'worker', 'storefront', 'seller', 'admin')]
    [string]$Only = 'all'
)

. "$PSScriptRoot\lib\common.ps1"
Set-Location $script:RepoRoot

if (-not (Test-Path '.env')) {
    Stop-WithError '.env not found. Run .\scripts\setup.ps1 first.'
}

if ($Only -eq 'all' -or $Only -eq 'api' -or $Only -eq 'worker') {
    Start-Infrastructure
}

Write-Step "Starting $Only (press Ctrl+C to stop)"
if ($Only -eq 'all') {
    pnpm dev
}
else {
    pnpm "dev:$Only"
}
exit $LASTEXITCODE
