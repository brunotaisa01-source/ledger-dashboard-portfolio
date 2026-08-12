@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "PACK_ROOT=%%~fI"

REM Working DB lives on local disk for speed and to avoid sync-client locks.
REM Local Fixture Store/Local Fixture Store synced folder is the shared source of truth.
if defined Synthetic_REPORTING_RUNTIME_ROOT (
  set "RUNTIME_ROOT=%Synthetic_REPORTING_RUNTIME_ROOT%"
) else (
  set "RUNTIME_ROOT=%PACK_ROOT%\runtime"
)
set "LOCAL_DB_BASE=%RUNTIME_ROOT%\work"
set "DEFAULT_ESCALATION_SOURCE=%PACK_ROOT%\data\Escalation\Escalations_Email_log.xlsx"

endlocal & (
  set "PROJECT=%PACK_ROOT%"
  set "Synthetic_REPORTING_DB_DIR=%LOCAL_DB_BASE%\db"
  set "Synthetic_REPORTING_DB_REMOTE=%PACK_ROOT%\runtime\db"
  set "Synthetic_REPORTING_SYNC_DIR=%PACK_ROOT%\runtime\db"
  set "Synthetic_REPORTING_LOCK_FILE=%PACK_ROOT%\runtime\db\.running.lock"
  set "Synthetic_REPORTING_BROWSER_DIR=%RUNTIME_ROOT%\browser\synthetic_review"
  set "Synthetic_REPORTING_ESCALATION_SOURCE=%DEFAULT_ESCALATION_SOURCE%"
  set "Synthetic_REPORTING_DISABLE_SYNTHETIC_REVIEW_ARCHIVE=0"
  set "Synthetic_REPORTING_DISABLE_ESCALATION_ARCHIVE=1"
  set "PYTHONDONTWRITEBYTECODE=1"
  set "DASHBOARD_LOCAL_DIR=%PACK_ROOT%\dashboard"
  set "DASHBOARD_OUTPUT_DIR=%PACK_ROOT%\dashboard"
  set "PYTHONPATH=%PACK_ROOT%"
)

if not exist "%Synthetic_REPORTING_DB_DIR%" mkdir "%Synthetic_REPORTING_DB_DIR%" >nul 2>&1
if not exist "%Synthetic_REPORTING_DB_REMOTE%" mkdir "%Synthetic_REPORTING_DB_REMOTE%" >nul 2>&1
if not exist "%DASHBOARD_LOCAL_DIR%" mkdir "%DASHBOARD_LOCAL_DIR%" >nul 2>&1
if not exist "%PROJECT%\runtime\logs" mkdir "%PROJECT%\runtime\logs" >nul 2>&1


set "PY_CMD="

if exist "%PROJECT%\.venv\Scripts\python.exe" (
  set "PY_CMD="%PROJECT%\.venv\Scripts\python.exe""
  goto :py_ok
)

call "%~dp0resolve_python_runtime.bat" PY_CMD
if not errorlevel 1 goto :py_ok

echo [FAIL] Python not found.
echo Run Install_WinPython_Runtime.bat once from the repository root.
exit /b 1

:py_ok
for /f "tokens=*" %%V in ('%PY_CMD% --version 2^>^&1') do set "PY_VERSION=%%V"
echo [OK] Python: %PY_VERSION%
echo [OK] Project: %PROJECT%
echo [OK] DB working (local): %Synthetic_REPORTING_DB_DIR%
echo [OK] DB shared mirror: %Synthetic_REPORTING_DB_REMOTE%
echo [OK] Dashboard dir: %DASHBOARD_OUTPUT_DIR%
exit /b 0



