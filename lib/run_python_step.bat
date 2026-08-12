@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "LOGFILE=%~1"
set "STEP_NAME=%~2"
set "MODULE_NAME=%~3"
shift
shift
shift
set "MODULE_ARGS="
:args_loop
if "%~1"=="" goto args_done
set "MODULE_ARGS=!MODULE_ARGS! %~1"
shift
goto args_loop
:args_done
if "%LOGFILE%"=="" set "LOGFILE=NUL"
if "%PY_CMD%"=="" (
  echo [FAIL] PY_CMD is not set
  echo [FAIL] PY_CMD is not set >> "%LOGFILE%"
  endlocal & exit /b 1
)
echo.
echo [RUN] %STEP_NAME%
echo [RUN] %STEP_NAME% >> "%LOGFILE%"
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "STEP_START_EPOCH=%%T"
%PY_CMD% -m %MODULE_NAME% %MODULE_ARGS% >> "%LOGFILE%" 2>&1
set "STEP_RC=%ERRORLEVEL%"
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$env:STEP_START_EPOCH"') do set "STEP_SECONDS=%%T"
echo [TIME] %STEP_NAME% %STEP_SECONDS%s
echo [TIME] %STEP_NAME% %STEP_SECONDS%s >> "%LOGFILE%"
if not "%STEP_RC%"=="0" (
  echo [FAIL] %STEP_NAME% exit=%STEP_RC%
  echo [FAIL] %STEP_NAME% exit=%STEP_RC% >> "%LOGFILE%"
  endlocal & exit /b %STEP_RC%
)
echo [OK] %STEP_NAME%
echo [OK] %STEP_NAME% >> "%LOGFILE%"
endlocal & exit /b 0