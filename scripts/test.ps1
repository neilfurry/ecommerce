<#
.SYNOPSIS
    Runs the automated test suites.

.PARAMETER Suite
    unit        Unit tests for every package and app (no services needed).
    integration API end-to-end and worker integration tests (needs docker compose services).
    ui          Playwright browser tests across the three frontends (needs services).
    all         Everything above plus typecheck and lint (default).

.EXAMPLE
    .\scripts\test.ps1
    .\scripts\test.ps1 -Suite unit
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'unit', 'integration', 'ui')]
    [string]$Suite = 'all'
)

. "$PSScriptRoot/lib/common.ps1"
Set-Location $script:RepoRoot

if ($Suite -eq 'all') {
    Write-Step 'Typecheck'
    Invoke-Checked 'pnpm' @('typecheck')
    Write-Step 'Lint'
    Invoke-Checked 'pnpm' @('lint')
}

if ($Suite -eq 'all' -or $Suite -eq 'unit') {
    Write-Step 'Unit tests'
    Invoke-Checked 'pnpm' @('test:unit')
}

if ($Suite -eq 'all' -or $Suite -eq 'integration' -or $Suite -eq 'ui') {
    Start-Infrastructure
    Write-Step 'Applying migrations and seed data'
    Invoke-Checked 'pnpm' @('db:deploy')
    Invoke-Checked 'pnpm' @('db:seed')
}

if ($Suite -eq 'all' -or $Suite -eq 'integration') {
    Write-Step 'API end-to-end tests'
    Invoke-Checked 'pnpm' @('test:e2e:api')
    Write-Step 'Worker integration tests'
    Invoke-Checked 'pnpm' @('test:integration:worker')
}

if ($Suite -eq 'all' -or $Suite -eq 'ui') {
    Write-Step 'Building API and worker for browser tests'
    Invoke-Checked 'pnpm' @('--filter', '@marketplace/api', '--filter', '@marketplace/worker', 'run', 'build')
    Write-Step 'Playwright browser tests'
    Invoke-Checked 'pnpm' @('test:e2e:ui')
}

Write-Host ''
Write-Host "All '$Suite' tests passed." -ForegroundColor Green
