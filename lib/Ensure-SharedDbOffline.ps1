param(
    [Parameter(Mandatory=$true)][string]$DbDir
)
$required = @(
    'key_weekly.sqlite',
    'ledger_weekly.sqlite',
    'synthetic_review_daily.sqlite',
    'escalation_daily.sqlite'
)
$bad = New-Object System.Collections.Generic.List[string]
foreach ($name in $required) {
    $path = Join-Path $DbDir $name
    if (-not (Test-Path -LiteralPath $path)) {
        $bad.Add("missing ${name}")
        continue
    }
    try {
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Length -le 0) {
            $bad.Add("empty ${name}")
            continue
        }
        $attrs = [int][System.IO.File]::GetAttributes($path)
        $isPlaceholder = (($attrs -band 0x1000) -ne 0) -or (($attrs -band 0x40000) -ne 0) -or (($attrs -band 0x400000) -ne 0)
        if ($isPlaceholder) {
            $bad.Add("placeholder ${name} len=$($item.Length) attrs=$attrs")
            continue
        }
        $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $buffer = New-Object byte[] ([Math]::Min(4096, [int]$fs.Length))
            [void]$fs.Read($buffer, 0, $buffer.Length)
        }
        finally {
            $fs.Dispose()
        }
    }
    catch {
        $bad.Add("not available ${name}: $($_.Exception.Message)")
    }
}
if ($bad.Count -gt 0) {
    foreach ($msg in $bad) { Write-Host "  - $msg" }
    exit 1
}
exit 0