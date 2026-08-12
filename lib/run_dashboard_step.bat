@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "LOGFILE=%~1"
set "STEP_NAME=%~2"
set "MODE=%~3"
shift
shift
shift
set "ROL_ARGS="
:args_loop
if "%~1"=="" goto args_done
set "ROL_ARGS=!ROL_ARGS! %~1"
shift
goto args_loop
:args_done
if "%LOGFILE%"=="" set "LOGFILE=NUL"
if "%PY_CMD%"=="" (
  echo [FAIL] PY_CMD is not set
  echo [FAIL] PY_CMD is not set >> "%LOGFILE%"
  endlocal & exit /b 1
)
if "%PROJECT%"=="" (
  echo [FAIL] PROJECT is not set
  echo [FAIL] PROJECT is not set >> "%LOGFILE%"
  endlocal & exit /b 1
)
set "VERIFY_SCRIPT=%PROJECT%\automation\Verify-DashboardArtifacts.ps1"
if not exist "%VERIFY_SCRIPT%" (
  echo [FAIL] Dashboard verifier not found: %VERIFY_SCRIPT%
  echo [FAIL] Dashboard verifier not found: %VERIFY_SCRIPT% >> "%LOGFILE%"
  endlocal & exit /b 1
)
echo.
echo [RUN] %STEP_NAME%
echo [RUN] %STEP_NAME% >> "%LOGFILE%"
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "STEP_START_EPOCH=%%T"
set "DASH_START_EPOCH=%STEP_START_EPOCH%"
%PY_CMD% -m scripts.dashboard.Rol_Query --force-html --local-only %ROL_ARGS% >> "%LOGFILE%" 2>&1
set "STEP_RC=%ERRORLEVEL%"
if not "%STEP_RC%"=="0" (
  echo [FAIL] %STEP_NAME% exit=%STEP_RC%
  echo [FAIL] %STEP_NAME% exit=%STEP_RC% >> "%LOGFILE%"
  endlocal & exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%VERIFY_SCRIPT%" -OutputDir "%DASHBOARD_OUTPUT_DIR%" -CutoffEpoch "%DASH_START_EPOCH%" -Mode "%MODE%" >> "%LOGFILE%" 2>&1
set "VERIFY_RC=%ERRORLEVEL%"
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$env:STEP_START_EPOCH"') do set "STEP_SECONDS=%%T"
echo [TIME] %STEP_NAME% %STEP_SECONDS%s
echo [TIME] %STEP_NAME% %STEP_SECONDS%s >> "%LOGFILE%"
if not "%VERIFY_RC%"=="0" (
  echo [FAIL] %STEP_NAME% did not refresh dashboard data artifacts
  echo [FAIL] %STEP_NAME% stale output verify=%VERIFY_RC% >> "%LOGFILE%"
  endlocal & exit /b 1
)
echo [OK] %STEP_NAME%
echo [OK] %STEP_NAME% >> "%LOGFILE%"
endlocal & exit /b 0