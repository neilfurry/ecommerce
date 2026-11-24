<#
.SYNOPSIS
    Drops and recreates the LOCAL development database, re-applies migrations and seeds it.
    All local data is lost. Never point this at a shared or production database.

.PARAMETER Force
    Skip the confirmation prompt.
#>
[CmdletBinding()]
param([switch]$Force)

. "$PSScriptRoot/lib/common.ps1"
Set-Location $script:RepoRoot

$envValues = Read-DotEnv
$databaseUrl = Get-EnvValue $envValues 'DATABASE_URL' ''
if ($databaseUrl -notmatch '@(localhost|127\.0\.0\.1)[:/]') {
    Stop-WithError "DATABASE_URL does not point at localhost. Refusing to reset: $($databaseUrl -replace '//[^@]*@', '//***@')"
}

if (-not $Force) {
    $answer = Read-Host 'This deletes ALL data in your local database. Type RESET to continue'
    if ($answer -ne 'RESET') {
        Write-Host 'Cancelled.'
        exit 0
    }
}

Start-Infrastructure
Write-Step 'Resetting database (migrate reset + seed)'
Invoke-Checked 'pnpm' @('db:reset')
Write-Ok 'Database reset complete'
