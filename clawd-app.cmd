@echo off
REM ---------------------------------------------------------------------
REM  Clawd Code - standalone desktop app.
REM
REM  Opens a real window using the system WebView2 runtime. No browser, no
REM  localhost URL. Pick a project folder from inside the app.
REM ---------------------------------------------------------------------
title Clawd Code

pushd "%~dp0"
set "REPO=%CD%"
popd

set "PY=%REPO%\.venv\Scripts\pythonw.exe"
set "PYCON=%REPO%\.venv\Scripts\python.exe"
set "PYTHONPATH=%REPO%"

if not exist "%PYCON%" (
    echo   ERROR: virtualenv not found at %PYCON%
    pause
    exit /b 1
)

REM Start from the folder the launcher was run in, so a shortcut dropped in a
REM project opens on that project. The app can change folder later anyway.
set "WORK=%CD%"

cd /d "%REPO%"

REM Clear any orphaned llama-server still holding VRAM from a hard exit.
"%PYCON%" -m src.local.cli stop all >nul 2>&1

REM pythonw.exe runs without a console window -- this is a desktop app, so a
REM stray black terminal behind it would look broken. Fall back to python.exe
REM if pythonw is missing.
if exist "%PY%" (
    start "" "%PY%" -m src.webui.app --workspace "%WORK%"
) else (
    "%PYCON%" -m src.webui.app --workspace "%WORK%"
)
