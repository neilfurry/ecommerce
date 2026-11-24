<#
.SYNOPSIS
    Starts the whole project: Docker services (PostgreSQL, Redis, MinIO, Mailpit), the API,
    the worker and the three frontends, with hot reload.

.PARAMETER Only
    Start a single app instead of all: api, worker, storefront, seller, admin.

.PARAMETER InfraOnly
    Start only the Docker services and wait until they are healthy.

.EXAMPLE
    .\scripts\start.ps1
    .\scripts\start.ps1 -Only api
    .\scripts\start.ps1 -InfraOnly
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'api', 'worker', 'storefront', 'seller', 'admin')]
    [string]$Only = 'all',
    [switch]$InfraOnly
)

. "$PSScriptRoot/lib/common.ps1"
Set-Location $script:RepoRoot

if (-not (Test-Path '.env')) {
    Stop-WithError '.env not found. Run .\scripts\setup.ps1 first.'
}

if ($InfraOnly -or $Only -eq 'all' -or $Only -eq 'api' -or $Only -eq 'worker') {
    Start-Infrastructure
}
if ($InfraOnly) {
    Write-Host ''
    Write-Host 'Services are running:' -ForegroundColor Green
    Write-Host '  PostgreSQL  localhost:5432'
    Write-Host '  Redis       localhost:6379'
    Write-Host '  MinIO       http://localhost:9000 (console http://localhost:9001)'
    Write-Host '  Mailpit     http://localhost:8025 (SMTP localhost:1025)'
    exit 0
}

Write-Step "Starting $Only (press Ctrl+C to stop the apps; .\scripts\stop.ps1 stops the services)"
Write-Host '  Storefront     http://localhost:5173'
Write-Host '  Seller Center  http://localhost:5174'
Write-Host '  Admin Console  http://localhost:5175'
Write-Host '  API + Swagger  http://localhost:3000/api/docs'
Write-Host '  Mailpit        http://localhost:8025'
if ($Only -eq 'all') {
    pnpm dev
}
else {
    pnpm "dev:$Only"
}
exit $LASTEXITCODE
