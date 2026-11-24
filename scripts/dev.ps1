<#
.SYNOPSIS
    Alias of start.ps1, kept for existing habits. See .\scripts\start.ps1 -?
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'api', 'worker', 'storefront', 'seller', 'admin')]
    [string]$Only = 'all'
)
& "$PSScriptRoot/start.ps1" -Only $Only
exit $LASTEXITCODE
