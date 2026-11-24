<#
.SYNOPSIS
    Stops the Docker services (PostgreSQL, Redis, MinIO, Mailpit).
    Apps started with start.ps1 stop with Ctrl+C in their window.

.PARAMETER RemoveData
    Also delete all local data volumes (database, files, emails). Asks for confirmation.

.PARAMETER Force
    Skip the confirmation for -RemoveData.

.EXAMPLE
    .\scripts\stop.ps1
    .\scripts\stop.ps1 -RemoveData
#>
[CmdletBinding()]
param(
    [switch]$RemoveData,
    [switch]$Force
)

. "$PSScriptRoot/lib/common.ps1"
Set-Location $script:RepoRoot
Assert-DockerRunning

if ($RemoveData) {
    if (-not $Force) {
        $answer = Read-Host 'This deletes ALL local data (database, uploaded files, emails). Type DELETE to continue'
        if ($answer -ne 'DELETE') {
            Write-Host 'Cancelled.'
            exit 0
        }
    }
    Write-Step 'Stopping services and deleting local data'
    Invoke-Checked 'docker' (Get-ComposeArgs @('down', '--volumes', '--remove-orphans'))
    Write-Ok 'Services stopped and data deleted. Run .\scripts\setup.ps1 to start fresh.'
}
else {
    Write-Step 'Stopping services (data is kept)'
    Invoke-Checked 'docker' (Get-ComposeArgs @('stop'))
    Write-Ok 'Services stopped. Start again with .\scripts\start.ps1'
}
