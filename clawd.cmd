@echo off
REM ---------------------------------------------------------------------
REM  Clawd Code - terminal interface.
REM  Lives in the repo root; the desktop shortcut points here.
REM
REM  Runs the agent in whatever folder you launch it from, so a copy of the
REM  shortcut dropped in a project folder works on that project.
REM ---------------------------------------------------------------------
title Clawd Code

REM %~dp0 carries a trailing backslash; round-trip through pushd for a clean path.
pushd "%~dp0"
set "REPO=%CD%"
popd

set "PY=%REPO%\.venv\Scripts\python.exe"
set "PYTHONPATH=%REPO%"
set "PYTHONUNBUFFERED=1"

if not exist "%PY%" (
    echo.
    echo   ERROR: virtualenv not found at
    echo     %PY%
    echo.
    echo   Recreate it with:
    echo     python -m venv "%REPO%\.venv"
    echo     "%PY%" -m pip install -r "%REPO%\requirements.txt" pyyaml psutil huggingface_hub
    echo.
    pause
    exit /b 1
)

REM Work where the user launched from; fall back to the repo when that is the
REM launcher's own folder, so the agent always has code to look at.
set "WORK=%CD%"

cd /d "%REPO%"

REM A hard exit (closing the window, Ctrl+Break) can orphan a llama-server
REM still holding VRAM, which stops the next session from starting.
"%PY%" -m src.local.cli stop all >nul 2>&1

if /i "%~1"=="doctor" (
    "%PY%" -m src.local.cli doctor
    echo.
    pause
    exit /b 0
)

if /i "%~1"=="stop" (
    "%PY%" -m src.local.cli stop all
    echo.
    pause
    exit /b 0
)

cd /d "%WORK%"
"%PY%" -m src.cli %*

cd /d "%REPO%"
"%PY%" -m src.local.cli stop all >nul 2>&1

echo.
echo   Session ended. GPU memory released.
timeout /t 3 >nul
