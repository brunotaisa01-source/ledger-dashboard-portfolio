@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "PACK_ROOT=%%~fI"
set "DASHBOARD_HTML=%PACK_ROOT%\dashboard\dashboard.html"

if not exist "%DASHBOARD_HTML%" (
  echo [FAIL] Dashboard not found:
  echo        %DASHBOARD_HTML%
  if not "%NOPAUSE%"=="1" pause
  exit /b 1
)

start "" "%DASHBOARD_HTML%"
exit /b 0
