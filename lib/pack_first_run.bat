@echo off
REM ============================================================
REM  pack_first_run.bat
REM  First-run bootstrap for a Local Fixture Store/Local Fixture Store synced laptop.
REM ============================================================

setlocal EnableExtensions EnableDelayedExpansion
set "LOGFILE=%~1"
if "%LOGFILE%"=="" set "LOGFILE=NUL"

if "%PROJECT%"=="" (
  echo [first_run] PROJECT not set. Did you call pack_env.bat?
  endlocal & exit /b 1
)
if "%Synthetic_REPORTING_DB_REMOTE%"=="" (
  echo [first_run] Synthetic_REPORTING_DB_REMOTE not set. Did you call pack_env.bat?
  endlocal & exit /b 1
)

set "LOCAL_ENV_DIR=%PROJECT%\runtime\config"
set "LOCAL_ENV=%LOCAL_ENV_DIR%\.env"
if not exist "%LOCAL_ENV_DIR%" mkdir "%LOCAL_ENV_DIR%" >nul 2>&1

if not exist "%LOCAL_ENV%" (
  if exist "%PROJECT%\.env.example" (
    copy "%PROJECT%\.env.example" "%LOCAL_ENV%" >nul
  ) else (
    > "%LOCAL_ENV%" echo # Local runtime env for Dashboard Ledger Local Fixture Store Pack
    >> "%LOCAL_ENV%" echo SYNTHETIC_REVIEW_EMAIL=
    >> "%LOCAL_ENV%" echo NOTIFY_EMAIL=
  )
  echo [SETUP] Created local runtime env: %LOCAL_ENV%
  echo [SETUP] Created local runtime env: %LOCAL_ENV% >> "%LOGFILE%"
) else (
  echo [SETUP] Local runtime env ready: %LOCAL_ENV% >> "%LOGFILE%"
)

if not exist "%Synthetic_REPORTING_DB_REMOTE%" mkdir "%Synthetic_REPORTING_DB_REMOTE%" >nul 2>&1

echo [SETUP] Ensuring shared DB mirror is available offline...
echo [SETUP] Ensuring shared DB mirror is available offline... >> "%LOGFILE%"
attrib +P -U "%Synthetic_REPORTING_DB_REMOTE%\*.sqlite" >nul 2>&1

set "HYDRATE_ATTEMPT=1"
set "HYDRATE_ATTEMPTS=18"
:wait_for_hydrate
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Ensure-SharedDbOffline.ps1" -DbDir "%Synthetic_REPORTING_DB_REMOTE%" >> "%LOGFILE%" 2>&1
if not errorlevel 1 goto :hydrate_ready
if %HYDRATE_ATTEMPT% GEQ %HYDRATE_ATTEMPTS% goto :hydrate_failed
echo [WAIT] Local Fixture Store is downloading shared DB files (%HYDRATE_ATTEMPT%/%HYDRATE_ATTEMPTS%)...
echo [WAIT] Local Fixture Store is downloading shared DB files (%HYDRATE_ATTEMPT%/%HYDRATE_ATTEMPTS%)... >> "%LOGFILE%"
timeout /t 10 /nobreak >nul
set /a HYDRATE_ATTEMPT+=1
goto :wait_for_hydrate

:hydrate_failed
echo [FAIL] Shared DB files are still cloud-only or unavailable after waiting.
echo [FAIL] Shared DB files are still cloud-only or unavailable after waiting. >> "%LOGFILE%"
echo Open Local Fixture Store, keep this folder synced, and retry when runtime\db shows green ticks.
endlocal & exit /b 4

:hydrate_ready
echo [OK] Shared DB mirror is available offline.
echo [OK] Shared DB mirror is available offline. >> "%LOGFILE%"
endlocal & exit /b 0
