@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "PACK_ROOT=%%~fI"
set "LOCAL_ENV_DIR=%PACK_ROOT%\runtime\config"
set "LOCAL_ENV=%LOCAL_ENV_DIR%\.env"

if not exist "%LOCAL_ENV_DIR%" mkdir "%LOCAL_ENV_DIR%" >nul 2>&1

if not exist "%LOCAL_ENV%" (
  copy "%PACK_ROOT%\.env.example" "%LOCAL_ENV%" >nul
  echo [OK] Created local runtime env:
  echo      %LOCAL_ENV%
) else (
  echo [OK] Local runtime env already exists:
  echo      %LOCAL_ENV%
)

echo.
echo Fill SYNTHETIC_REVIEW_EMAIL and NOTIFY_EMAIL if this laptop will download SyntheticReview or send notifications.
notepad "%LOCAL_ENV%"
exit /b 0
