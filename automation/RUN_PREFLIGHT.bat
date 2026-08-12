@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Dashboard Ledger Local Fixture Store Pack - Preflight
color 0B

call "%~dp0..\lib\pack_env.bat"
if errorlevel 1 (
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

cd /d "%PROJECT%"

call "%~dp0..\lib\pack_first_run.bat" "NUL"
if errorlevel 1 (
  echo [FAIL] First-run setup failed. Fix Local Fixture Store sync and retry.
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

echo =====================================================
echo   Dashboard Ledger Local Fixture Store Pack
echo   PREFLIGHT - safe checks before running pipeline
echo =====================================================
echo.

%PY_CMD% -m scripts.tools.preflight_pack --mode manual
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo [FAIL] Preflight failed. Fix the messages above before running FULL/DAILY.
  if not "%NOPAUSE%"=="1" pause
  exit /b %RC%
)

echo.
echo [OK] Preflight passed.
if not "%NOPAUSE%"=="1" pause
exit /b 0
