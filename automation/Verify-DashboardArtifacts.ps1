param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [long]$CutoffEpoch,

    [Parameter(Mandatory = $true)]
    [ValidateSet('daily', 'full', 'rebuild-all')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
$cutoff = [DateTimeOffset]::FromUnixTimeSeconds($CutoffEpoch).UtcDateTime

$requiredFresh = @('dashboard.html', 'dashboard_data.js')
if ($Mode -eq 'full' -or $Mode -eq 'rebuild-all') {
    $requiredFresh += 'data\trend_cube.js'
}

$ok = $true
foreach ($relativePath in $requiredFresh) {
    $path = Join-Path $OutputDir $relativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Output "[FAIL] Missing dashboard output: $relativePath ($path)"
        $ok = $false
        continue
    }

    $item = Get-Item -LiteralPath $path
    if ($item.LastWriteTimeUtc -lt $cutoff) {
        Write-Output "[FAIL] Stale dashboard output: $relativePath last_write=$($item.LastWriteTimeUtc.ToString('s')) cutoff=$($cutoff.ToString('s'))"
        $ok = $false
        continue
    }

    Write-Output "Fresh dashboard output: $relativePath last_write=$($item.LastWriteTimeUtc.ToString('s'))"
}

if (-not $ok) {
    exit 3
}

if ($Mode -eq 'daily') {
    $cube = Join-Path $OutputDir 'data\trend_cube.js'
    if (Test-Path -LiteralPath $cube) {
        $cubeItem = Get-Item -LiteralPath $cube
        Write-Output "Info: trend_cube.js freshness not required for mode=$Mode last_write=$($cubeItem.LastWriteTimeUtc.ToString('s'))"
    }
}

exit 0