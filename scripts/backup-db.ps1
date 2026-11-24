<#
.SYNOPSIS
    Creates a compressed PostgreSQL backup (pg_dump custom format) in .\backups and
    deletes backups older than the retention period.

.DESCRIPTION
    The dump is written inside the container and then copied out, because PowerShell 5.1
    pipes would re-encode (and corrupt) binary output.
    Schedule it with Windows Task Scheduler for automatic daily backups (see
    docs/windows-setup.md, "Automatic backups").

.PARAMETER RetentionDays
    Backups older than this many days are deleted. Default 14. Use 0 to keep everything.

.EXAMPLE
    .\scripts\backup-db.ps1
    .\scripts\backup-db.ps1 -RetentionDays 30
#>
[CmdletBinding()]
param([int]$RetentionDays = 14)

. "$PSScriptRoot\lib\common.ps1"
Set-Location $script:RepoRoot
Assert-DockerRunning

$envValues = Read-DotEnv
$dbUser = Get-EnvValue $envValues 'POSTGRES_USER' 'marketplace'
$dbName = Get-EnvValue $envValues 'POSTGRES_DB' 'marketplace'

$backupDir = Join-Path $script:RepoRoot 'backups'
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$fileName = "$dbName-$timestamp-utc.dump"
$containerPath = "/tmp/$fileName"
$hostPath = Join-Path $backupDir $fileName

Write-Step "Backing up database '$dbName'"
Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', $dbUser, '-d', $dbName, '--format=custom', '--no-owner', '--file', $containerPath)
Invoke-Checked 'docker' @('compose', 'cp', "postgres:$containerPath", $hostPath)
Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'rm', '-f', $containerPath)

$size = [math]::Round((Get-Item $hostPath).Length / 1KB, 1)
Write-Ok "Saved $hostPath ($size KB)"

if ($RetentionDays -gt 0) {
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    $old = Get-ChildItem $backupDir -Filter '*.dump' | Where-Object { $_.LastWriteTime -lt $cutoff }
    foreach ($file in $old) {
        Remove-Item $file.FullName
        Write-Ok "Deleted old backup $($file.Name)"
    }
}
