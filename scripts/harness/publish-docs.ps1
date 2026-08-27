#Requires -Version 5.1
<#
.SYNOPSIS
  Invoke the Confluence documentation publisher from Windows PowerShell.

.DESCRIPTION
  Resolves the harness repository root from this script's location, so it works
  from any working directory. Dry-run is the default. Pass -Publish to write.

  Credentials stay in the environment. The API token is CONFLUENCE_API_TOKEN,
  falling back to JIRA_API_TOKEN because an Atlassian API token is
  account-scoped, not product-scoped.
#>
[CmdletBinding()]
param(
    [switch]$Publish
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$publisher = 'scripts/harness/publish-docs-confluence.mjs'

$email = $env:CONFLUENCE_EMAIL
$token = $env:CONFLUENCE_API_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    $token = $env:JIRA_API_TOKEN
}

$emailResolved = -not [string]::IsNullOrWhiteSpace($email)
$tokenResolved = -not [string]::IsNullOrWhiteSpace($token)

Write-Host ("CONFLUENCE_EMAIL resolved: {0}" -f $emailResolved)
Write-Host ("API token resolved: {0}" -f $tokenResolved)

if ($Publish) {
    $missing = @()
    if (-not $emailResolved) {
        $missing += 'CONFLUENCE_EMAIL'
    }
    if (-not $tokenResolved) {
        $missing += 'CONFLUENCE_API_TOKEN (JIRA_API_TOKEN fallback also empty)'
    }
    if ($missing.Count -gt 0) {
        [Console]::Error.WriteLine(('-Publish needs {0} in the environment. Node was not invoked.' -f ($missing -join ' and ')))
        exit 1
    }
}

# The publisher reads CONFLUENCE_API_TOKEN. Forward the Jira fallback so a
# resolved token is actually visible to node. Restore afterwards so this
# session is not left holding a copy.
$previousConfluenceToken = $env:CONFLUENCE_API_TOKEN
if ([string]::IsNullOrWhiteSpace($env:CONFLUENCE_API_TOKEN)) {
    if ($tokenResolved) {
        $env:CONFLUENCE_API_TOKEN = $token
    }
}

$nodeArgs = @($publisher)
if ($Publish) {
    $nodeArgs += '--publish'
}

$code = $null
try {
    Push-Location $repoRoot
    try {
        & node @nodeArgs
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    $env:CONFLUENCE_API_TOKEN = $previousConfluenceToken
}

if ($null -eq $code) {
    exit 1
}
exit $code
