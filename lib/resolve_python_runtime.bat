@echo off
REM Resolves the Dashboard Ledger Python command for the Operations Pack.

set "TARGET_VAR=%~1"
if not defined TARGET_VAR set "TARGET_VAR=PY_CMD"
set "PYTHON_RUNTIME_SOURCE="

if defined Synthetic_REPORTING_PYTHON_EXE (
  if exist "%Synthetic_REPORTING_PYTHON_EXE%" (
    call set "%TARGET_VAR%="%%Synthetic_REPORTING_PYTHON_EXE%%""
    set "PYTHON_RUNTIME_SOURCE=Synthetic_REPORTING_PYTHON_EXE"
    exit /b 0
  )
)

for %%I in ("%~dp0..") do set "PACK_ROOT=%%~fI"

call :try_exe "%PACK_ROOT%\runtime\python\WinPython\WPy64-31190b5\python-3.11.9.amd64\python.exe" "pack-local WinPython 3.11.9"
if not errorlevel 1 exit /b 0

call :try_exe "%PACK_ROOT%\runtime\python\WinPython\python-3.11.9.amd64\python.exe" "pack-local WinPython 3.11.9"
if not errorlevel 1 exit /b 0

py -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 (
  call set "%TARGET_VAR%=py -3.11"
  set "PYTHON_RUNTIME_SOURCE=py -3.11"
  exit /b 0
)

python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 (
  call set "%TARGET_VAR%=python"
  set "PYTHON_RUNTIME_SOURCE=python"
  exit /b 0
)

echo [FAIL] Python 3.11 runtime not found.
echo Run Install_WinPython_Runtime.bat once from the repository root, or set Synthetic_REPORTING_PYTHON_EXE.
exit /b 1

:try_exe
if not exist "%~1" exit /b 1
"%~1" -c "import sys; raise SystemExit(0 if sys.version_info[:3] == (3, 11, 9) else 1)" >nul 2>&1
if errorlevel 1 exit /b 1
call set "%TARGET_VAR%="%~1""
set "PYTHON_RUNTIME_SOURCE=%~2"
exit /b 0
