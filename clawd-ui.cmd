@echo off
REM ---------------------------------------------------------------------
REM  Clawd Code - graphical interface.
REM  Lives in the repo root; the desktop shortcut points here.
REM
REM  Runs the agent in whatever folder you launch it from, so a copy of the
REM  shortcut dropped in a project folder works on that project.
REM ---------------------------------------------------------------------
title Clawd Code UI

REM %~dp0 carries a trailing backslash; round-trip through pushd for a clean path.
pushd "%~dp0"
set "REPO=%CD%"
popd

set "PY=%REPO%\.venv\Scripts\python.exe"
set "PYTHONPATH=%REPO%"
set "PYTHONUNBUFFERED=1"
set "PORT=8765"

if not exist "%PY%" (
    echo.
    echo   ERROR: virtualenv not found at
    echo     %PY%
    echo.
    pause
    exit /b 1
)

REM Work where the user launched from. Double-clicking the launcher inside the
REM repo means WORK is the repo, which is a sensible default.
set "WORK=%CD%"

cd /d "%REPO%"

REM A hard exit can orphan a llama-server still holding VRAM.
"%PY%" -m src.local.cli stop all >nul 2>&1

echo.
echo   Clawd Code UI
echo   ----------------------------------------
echo   Working in : %WORK%
echo   Opening    : http://127.0.0.1:%PORT%
echo.
echo   Keep this window open while you use it.
echo   Close it, or press Ctrl+C, to shut down.
echo.

REM Give the server a moment to bind before the browser asks for the page.
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%"

"%PY%" -m src.webui --port %PORT% --workspace "%WORK%"

REM Release GPU memory on the way out.
"%PY%" -m src.local.cli stop all >nul 2>&1
echo.
echo   Stopped. GPU memory released.
timeout /t 3 >nul
