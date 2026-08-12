@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Dashboard Ledger Operations Pack - MONTHLY FULL Cycle
color 0A

call "%~dp0..\lib\pack_env.bat"
if errorlevel 1 (
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

cd /d "%PROJECT%"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "RUN_ID=%%I"
set "LOGFILE=%PROJECT%\runtime\logs\full_%RUN_ID%.log"

echo =====================================================
echo   Dashboard Ledger Local Fixture Store Pack
echo   RUN FULL - Monthly Source Cycle + Validation
echo   Local Fixture Store synced output only. Shared DB mirror via runtime\db.
echo =====================================================
echo.
echo [OK] Log: %LOGFILE%
echo.

echo Start: %date% %time% > "%LOGFILE%"
echo Mode: full_monthly >> "%LOGFILE%"
echo PROJECT=%PROJECT% >> "%LOGFILE%"
echo Synthetic_REPORTING_DB_DIR=%Synthetic_REPORTING_DB_DIR% >> "%LOGFILE%"
echo Synthetic_REPORTING_DB_REMOTE=%Synthetic_REPORTING_DB_REMOTE% >> "%LOGFILE%"
echo Synthetic_REPORTING_SYNC_DIR=%Synthetic_REPORTING_SYNC_DIR% >> "%LOGFILE%"
set "RUN_LOCK=%PROJECT%\scripts\tools\run_lock.py"

REM ---- First-run bootstrap -------------------------------------
echo.
echo [SETUP] first-run bootstrap
echo [SETUP] first-run bootstrap >> "%LOGFILE%"
call "%~dp0..\lib\pack_first_run.bat" "%LOGFILE%"
if errorlevel 1 (
  echo [FAIL] First-run setup failed. Aborting run.
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

REM ---- Preflight ------------------------------------------------
echo.
echo [PREFLIGHT] checking pack readiness
echo [PREFLIGHT] checking pack readiness >> "%LOGFILE%"
%PY_CMD% -m scripts.tools.preflight_pack --mode full >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [FAIL] Preflight failed. Aborting run.
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

REM ---- Acquire shared run lock --------------------------------
echo.
echo [LOCK] acquiring shared run lock
echo [LOCK] acquire >> "%LOGFILE%"
if not exist "%RUN_LOCK%" (
  echo [FAIL] Pack file missing or not synced: %RUN_LOCK%
  echo [FAIL] Pack file missing or not synced: %RUN_LOCK% >> "%LOGFILE%"
  exit /b 1
)
%PY_CMD% "%RUN_LOCK%" acquire --mode full >> "%LOGFILE%" 2>&1
set "LOCK_RC=%ERRORLEVEL%"
if %LOCK_RC%==1 (
  echo [FAIL] Another teammate is running the pipeline. Try again later.
  type "%Synthetic_REPORTING_LOCK_FILE%" 2>nul
  if not "%NOPAUSE%"=="1" pause
  exit /b 2
)
if %LOCK_RC%==3 (
  echo [FAIL] Local Fixture Store conflict copy detected near the lock file. Resolve and retry.
  if not "%NOPAUSE%"=="1" pause
  exit /b 3
)
if %LOCK_RC%==2 (
  echo [WARN] Stale lock from a previous run was purged. Continuing.
)

REM ---- Pull latest DBs from Local Fixture Store --------------------------
call "%~dp0..\lib\pack_db_sync.bat" pull "%LOGFILE%"
if errorlevel 1 (
  echo [FAIL] DB pull from Local Fixture Store failed. Aborting run.
  %PY_CMD% "%RUN_LOCK%" release >> "%LOGFILE%" 2>&1
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

set "FAILS=0"
set "WARNS=0"

REM ---- Pipeline -----------------------------------------------
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "MasterData monthly" scripts.reports.build_masterdata_monthly
if errorlevel 1 (
  set /a FAILS+=1
  goto fail_required
)
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Key report" scripts.reports.build_key_report
if errorlevel 1 (
  set /a FAILS+=1
  goto fail_required
)
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Ledger report" scripts.reports.build_ledger_report
if errorlevel 1 (
  set /a FAILS+=1
  goto fail_required
)
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Ledger/Key loader latest" scripts.loaders.load_ledger_weekly_to_sqlite_clean_split --latest
if errorlevel 1 (
  set /a FAILS+=1
  goto fail_required
)
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Escalation loader" scripts.loaders.escalation_loader
if errorlevel 1 set /a WARNS+=1
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "SyntheticReview loader" scripts.loaders.synthetic_review_loader
if errorlevel 1 set /a WARNS+=1
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Statement loader" scripts.loaders.statement_loader
if errorlevel 1 set /a WARNS+=1
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Storebook ZR report" scripts.reports.build_storebook_zr_report
if errorlevel 1 set /a WARNS+=1
call "%~dp0..\lib\run_dashboard_step.bat" "%LOGFILE%" "Dashboard local HTML" full --incremental-trend-cube
if errorlevel 1 (
  set /a FAILS+=1
  goto fail_required
)
call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Health check" scripts.utils.health_check
if errorlevel 1 set /a WARNS+=1

REM ---- Validation (local only; never validate stale dashboard output) ----
if "%FAILS%"=="0" (
  call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Validate dashboard" scripts.validation.validate_data --stage dashboard
  if errorlevel 1 set /a FAILS+=1
  call "%~dp0..\lib\run_python_step.bat" "%LOGFILE%" "Validate cross" scripts.validation.validate_data --stage cross
  if errorlevel 1 set /a FAILS+=1
) else (
  echo [FAIL] Required pipeline step failed before validation. Skipping validation of stale outputs.
  echo [FAIL] Required pipeline step failed before validation. Skipping validation of stale outputs. >> "%LOGFILE%"
)
REM ---- Push DBs back to Local Fixture Store (only after required steps pass)
call "%~dp0..\lib\pack_db_sync.bat" push "%LOGFILE%"
set "PUSH_RC=%ERRORLEVEL%"
if not "%PUSH_RC%"=="0" (
  echo [WARN] DB push to Local Fixture Store returned %PUSH_RC%. Check log.
  set /a WARNS+=1
)
goto release_lock

:fail_required
echo [FAIL] Required pipeline step failed. Stopping before downstream steps and DB push.
echo [FAIL] Required pipeline step failed. Stopping before downstream steps and DB push. >> "%LOGFILE%"

REM ---- Release lock (always) ----------------------------------
:release_lock
%PY_CMD% "%RUN_LOCK%" release >> "%LOGFILE%" 2>&1
echo [LOCK] released >> "%LOGFILE%"

echo.
echo =====================================================
echo   RUN FULL Summary
echo =====================================================
echo [OK] Log: %LOGFILE%
echo [OK] Warnings: %WARNS%
echo [OK] Failures: %FAILS%

echo End: %date% %time% >> "%LOGFILE%"
echo WARN=%WARNS% FAIL=%FAILS% >> "%LOGFILE%"

if not "%FAILS%"=="0" (
  echo [FAIL] Full pipeline finished with required step failures.
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

echo [OK] Monthly full cycle completed. Open dashboard\dashboard.html to view.
if not "%NOPAUSE%"=="1" pause
exit /b 0

:run_required
set "STEP_NAME=%~1"
set "MODULE_NAME=%~2"
set "MODULE_ARGS=%~3 %~4 %~5 %~6"
echo.
echo [RUN] %STEP_NAME%
echo [RUN] %STEP_NAME% >> "%LOGFILE%"
call :mark_step_start
%PY_CMD% -m %MODULE_NAME% %MODULE_ARGS% >> "%LOGFILE%" 2>&1
call :log_step_time "%STEP_NAME%"
if errorlevel 1 (
  echo [FAIL] %STEP_NAME%
  echo [FAIL] %STEP_NAME% >> "%LOGFILE%"
  set /a FAILS+=1
) else (
  echo [OK] %STEP_NAME%
  echo [OK] %STEP_NAME% >> "%LOGFILE%"
)
exit /b 0

:run_dashboard_required
set "STEP_NAME=%~1"
echo.
echo [RUN] %STEP_NAME%
echo [RUN] %STEP_NAME% >> "%LOGFILE%"
call :mark_step_start
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "DASH_START_EPOCH=%%T"
%PY_CMD% -m scripts.dashboard.Rol_Query --force-html --local-only --incremental-trend-cube >> "%LOGFILE%" 2>&1
set "STEP_RC=%ERRORLEVEL%"
if not "%STEP_RC%"=="0" (
  echo [FAIL] %STEP_NAME%
  echo [FAIL] %STEP_NAME% exit=%STEP_RC% >> "%LOGFILE%"
  set /a FAILS+=1
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Verify-DashboardArtifacts.ps1" -OutputDir "%DASHBOARD_OUTPUT_DIR%" -CutoffEpoch "%DASH_START_EPOCH%" -Mode "full" >> "%LOGFILE%" 2>&1
set "VERIFY_RC=%ERRORLEVEL%"
call :log_step_time "%STEP_NAME%"
if not "%VERIFY_RC%"=="0" (
  echo [FAIL] %STEP_NAME% did not refresh dashboard data artifacts
  echo [FAIL] %STEP_NAME% stale output verify=%VERIFY_RC% >> "%LOGFILE%"
  set /a FAILS+=1
) else (
  echo [OK] %STEP_NAME%
  echo [OK] %STEP_NAME% >> "%LOGFILE%"
)
exit /b 0
:run_optional
set "STEP_NAME=%~1"
set "MODULE_NAME=%~2"
set "MODULE_ARGS=%~3 %~4 %~5 %~6"
echo.
echo [RUN] %STEP_NAME%
echo [RUN] %STEP_NAME% >> "%LOGFILE%"
call :mark_step_start
%PY_CMD% -m %MODULE_NAME% %MODULE_ARGS% >> "%LOGFILE%" 2>&1
call :log_step_time "%STEP_NAME%"
if errorlevel 1 (
  echo [WARN] %STEP_NAME% failed or had no new data. Continuing.
  echo [WARN] %STEP_NAME% >> "%LOGFILE%"
  set /a WARNS+=1
) else (
  echo [OK] %STEP_NAME%
  echo [OK] %STEP_NAME% >> "%LOGFILE%"
)
exit /b 0

:mark_step_start
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "STEP_START_EPOCH=%%T"
exit /b 0

:log_step_time
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$env:STEP_START_EPOCH"') do set "STEP_SECONDS=%%T"
echo [TIME] %~1 %STEP_SECONDS%s
echo [TIME] %~1 %STEP_SECONDS%s >> "%LOGFILE%"
exit /b 0
