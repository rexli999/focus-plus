@echo off
setlocal

cd /d "%~dp0"
set "APP_URL=http://localhost:8000/"
set "HEALTH_URL=http://localhost:8000/api/state"
set "PYTHON_CMD="
set "BROWSER_CMD="
set "APP_PROFILE_DIR=%LOCALAPPDATA%\FocusPlus\chrome-profile"

where python >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  where py >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  echo Python was not found. Install Python or change this script to your local server command.
  pause
  exit /b 1
)

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  set "BROWSER_CMD=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
  set "BROWSER_CMD=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

set "SERVER_OK="
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 set "SERVER_OK=1"

if not defined SERVER_OK (
  start "Focus+ Server" cmd /k "cd /d ""%~dp0"" && %PYTHON_CMD% focusplus_server.py --host localhost --port 8000"
  timeout /t 2 >nul
)

if defined BROWSER_CMD (
  if not exist "%APP_PROFILE_DIR%" mkdir "%APP_PROFILE_DIR%" >nul 2>&1
  start "" "%BROWSER_CMD%" --user-data-dir="%APP_PROFILE_DIR%" --app="%APP_URL%"
) else (
  start "" "%APP_URL%"
)

endlocal
