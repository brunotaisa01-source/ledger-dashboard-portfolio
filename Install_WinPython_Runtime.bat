@echo off
setlocal
if not defined SYNTHETIC_WINPYTHON_INSTALLER (
  echo [FAIL] Set SYNTHETIC_WINPYTHON_INSTALLER to an already-downloaded local installer.
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0automation\install_winpython_runtime.ps1" -InstallerPath "%SYNTHETIC_WINPYTHON_INSTALLER%"
exit /b %ERRORLEVEL%
