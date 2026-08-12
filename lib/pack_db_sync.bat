@echo off
REM ============================================================
REM  pack_db_sync.bat
REM  Local Fixture Store/Local Fixture Store synced DB mirror <-> local DB helpers.
REM
REM  Usage:
REM      call "%~dp0..\lib\pack_db_sync.bat" pull  "%LOGFILE%"
REM      call "%~dp0..\lib\pack_db_sync.bat" push  "%LOGFILE%"
REM
REM  Requires env vars set by pack_env.bat:
REM      Synthetic_REPORTING_DB_DIR     - configurable local working copy
REM      Synthetic_REPORTING_DB_REMOTE  - shared synced copy (PACK_ROOT\runtime\db)
REM ============================================================

setlocal EnableExtensions EnableDelayedExpansion

set "ACTION=%~1"
set "LOGFILE=%~2"

if "%ACTION%"=="" (
  echo [pack_db_sync] missing action
  endlocal & exit /b 1
)
if "%Synthetic_REPORTING_DB_DIR%"=="" (
  echo [pack_db_sync] Synthetic_REPORTING_DB_DIR not set. Did you call pack_env.bat?
  endlocal & exit /b 1
)
if "%Synthetic_REPORTING_DB_REMOTE%"=="" (
  echo [pack_db_sync] Synthetic_REPORTING_DB_REMOTE not set. Did you call pack_env.bat?
  endlocal & exit /b 1
)
if "%LOGFILE%"=="" set "LOGFILE=NUL"

if /I "%ACTION%"=="pull" goto :do_pull
if /I "%ACTION%"=="push" goto :do_push

echo [pack_db_sync] unknown action: %ACTION%
endlocal & exit /b 1

:do_pull
echo. >> "%LOGFILE%"
echo [SYNC] PULL shared mirror -^> local >> "%LOGFILE%"
echo [SYNC] PULL shared mirror -^> local

REM Abort if a sync conflict copy is sitting next to the remote DBs.
for %%F in ("%Synthetic_REPORTING_DB_REMOTE%\*conflicted*" "%Synthetic_REPORTING_DB_REMOTE%\*Conflict*") do (
  if exist "%%~F" (
    echo [FAIL] Sync conflict copy detected: %%~F >> "%LOGFILE%"
    echo [FAIL] Sync conflict copy detected: %%~F
    echo Resolve it before running the pipeline.
    endlocal & exit /b 3
  )
)

REM Pre-flight: ensure no cloud-only placeholders or 0-byte files.
REM Cloud-only files have attribute O (Offline) or P (recall on data access).
REM Empty files mean Local Fixture Store/Local Fixture Store sync has not finished yet.
echo [SYNC] Ensuring shared DB files are available offline... >> "%LOGFILE%"
echo [SYNC] Ensuring shared DB files are available offline...
attrib +P -U "%Synthetic_REPORTING_DB_REMOTE%\*.sqlite" >nul 2>&1

set "SYNC_ATTEMPT=1"
set "SYNC_ATTEMPTS=12"
:wait_for_remote_db
powershell -NoProfile -Command "$db = $env:Synthetic_REPORTING_DB_REMOTE; $files = Get-ChildItem -LiteralPath $db -Filter '*.sqlite' -File -ErrorAction SilentlyContinue; $bad = $files | Where-Object { $_.Length -eq 0 -or ([int]$_.Attributes -band 0x100000) -or ([int]$_.Attributes -band 0x400000) -or ([int]$_.Attributes -band 0x1000) }; if (-not $files) { Write-Host '  - no sqlite files found'; exit 1 }; if ($bad) { $bad | ForEach-Object { Write-Host ('  - {0} ({1} bytes, attrs={2})' -f $_.Name, $_.Length, $_.Attributes) }; exit 1 } else { exit 0 }" >> "%LOGFILE%" 2>&1
if not errorlevel 1 goto :remote_db_ready
if %SYNC_ATTEMPT% GEQ %SYNC_ATTEMPTS% goto :remote_db_not_ready
echo [WAIT] Shared DB files still downloading (%SYNC_ATTEMPT%/%SYNC_ATTEMPTS%)...
echo [WAIT] Shared DB files still downloading (%SYNC_ATTEMPT%/%SYNC_ATTEMPTS%)... >> "%LOGFILE%"
timeout /t 10 /nobreak >nul
set /a SYNC_ATTEMPT+=1
goto :wait_for_remote_db

:remote_db_not_ready
  echo [FAIL] Local Fixture Store/Local Fixture Store sync not complete: shared DB files are placeholders or empty. >> "%LOGFILE%"
  echo [FAIL] Local Fixture Store/Local Fixture Store sync not complete: shared DB files are placeholders or empty.
  echo Open the sync icon and wait until all files in
  echo   %Synthetic_REPORTING_DB_REMOTE%
  echo show a green tick ^(not the cloud icon^) before retrying.
  endlocal & exit /b 4

:remote_db_ready

if not exist "%Synthetic_REPORTING_DB_DIR%" mkdir "%Synthetic_REPORTING_DB_DIR%" >nul 2>&1

REM robocopy options:
REM   /COPY:DAT  data+attrs+timestamps (no ACLs - faster, sync-client safe)
REM   /R:3 /W:5  retry 3 times, wait 5s
REM   /NJH /NJS  no headers/summary noise in the log
REM   /NDL       no directory list
REM   *.sqlite   only the canonical files (skip .sqlite-wal / .sqlite-shm)
robocopy "%Synthetic_REPORTING_DB_REMOTE%" "%Synthetic_REPORTING_DB_DIR%" *.sqlite ^
  /COPY:DAT /R:3 /W:5 /NJH /NJS /NDL /NP >> "%LOGFILE%" 2>&1
set "RC=%ERRORLEVEL%"
REM robocopy exit codes 0-7 are success, >=8 is failure.
if %RC% GEQ 8 (
  echo [FAIL] robocopy pull exit=%RC% >> "%LOGFILE%"
  echo [FAIL] robocopy pull exit=%RC%
  endlocal & exit /b 1
)
echo [OK] PULL complete (robocopy exit=%RC%) >> "%LOGFILE%"
echo [OK] PULL complete
endlocal & exit /b 0

:do_push
echo. >> "%LOGFILE%"
echo [SYNC] PUSH local -^> shared mirror >> "%LOGFILE%"
echo [SYNC] PUSH local -^> shared mirror

if not exist "%Synthetic_REPORTING_DB_DIR%" (
  echo [WARN] local DB dir missing, nothing to push >> "%LOGFILE%"
  echo [WARN] local DB dir missing, nothing to push
  endlocal & exit /b 0
)

REM Force SQLite into rollback-journal mode and delete WAL/SHM files
REM so the shared copy is a single self-contained .sqlite file.
for %%F in ("%Synthetic_REPORTING_DB_DIR%\*.sqlite-wal" "%Synthetic_REPORTING_DB_DIR%\*.sqlite-shm") do (
  if exist "%%~F" del /F /Q "%%~F" >nul 2>&1
)

if not exist "%Synthetic_REPORTING_DB_REMOTE%" mkdir "%Synthetic_REPORTING_DB_REMOTE%" >nul 2>&1

robocopy "%Synthetic_REPORTING_DB_DIR%" "%Synthetic_REPORTING_DB_REMOTE%" *.sqlite ^
  /COPY:DAT /R:3 /W:5 /NJH /NJS /NDL /NP >> "%LOGFILE%" 2>&1
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [FAIL] robocopy push exit=%RC% >> "%LOGFILE%"
  echo [FAIL] robocopy push exit=%RC%
  endlocal & exit /b 1
)
echo [OK] PUSH complete (robocopy exit=%RC%) >> "%LOGFILE%"
echo [OK] PUSH complete
endlocal & exit /b 0
