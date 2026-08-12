param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [string]$InstallRoot = ""
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\python\WinPython'
}
$resolved = (Resolve-Path -LiteralPath $InstallerPath).Path
$file = Get-Item -LiteralPath $resolved
if ($file.Length -lt 10000000) { throw 'Local installer is unexpectedly small.' }
$stream = [System.IO.File]::OpenRead($resolved)
try { $valid = ($stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A) }
finally { $stream.Dispose() }
if (-not $valid) { throw 'Local installer does not have an executable signature.' }
$process = Start-Process -FilePath $resolved -ArgumentList @('/S', "/D=$InstallRoot") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)" }
