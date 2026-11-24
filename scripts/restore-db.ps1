<#
.SYNOPSIS
    Restores a backup made by backup-db.ps1 into the LOCAL database, replacing its contents.

.PARAMETER File
    Path to the .dump file, e.g. .\backups\marketplace-20261124-090000-utc.dump

.PARAMETER Force
    Skip the confirmation prompt.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$File,
    [switch]$Force
)

. "$PSScriptRoot\lib\common.ps1"
Set-Location $script:RepoRoot
Assert-DockerRunning

if (-not (Test-Path $File)) { Stop-WithError "Backup file not found: $File" }
$resolved = (Resolve-Path $File).Path

$envValues = Read-DotEnv
$dbUser = Get-EnvValue $envValues 'POSTGRES_USER' 'marketplace'
$dbName = Get-EnvValue $envValues 'POSTGRES_DB' 'marketplace'

if (-not $Force) {
    $answer = Read-Host "This REPLACES all data in local database '$dbName'. Type RESTORE to continue"
    if ($answer -ne 'RESTORE') {
        Write-Host 'Cancelled.'
        exit 0
    }
}

$containerPath = '/tmp/restore.dump'
Write-Step "Restoring $resolved"
Invoke-Checked 'docker' @('compose', 'cp', $resolved, "postgres:$containerPath")
Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'pg_restore', '-U', $dbUser, '-d', $dbName, '--clean', '--if-exists', '--no-owner', '--single-transaction', $containerPath)
Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'rm', '-f', $containerPath)
Write-Ok 'Restore complete'
