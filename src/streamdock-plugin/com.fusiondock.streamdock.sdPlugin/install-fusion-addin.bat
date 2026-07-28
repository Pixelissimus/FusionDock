@echo off
setlocal

rem  FusionDock -- installs the Fusion half.
rem
rem  This plugin is two pieces. The Stream Dock software installed the first one (the keys).
rem  This script installs the second: a Fusion 360 add-in that reads what you are doing and
rem  runs the commands the keys send.
rem
rem  Deliberately a .bat and nothing else. It has to run on a machine with no Node, no Python
rem  and no developer tools -- Fusion brings its own Python, and the add-in uses only that.
rem  xcopy has shipped with Windows since forever and needs nothing installed.

title FusionDock - add-in installer

set "SOURCE=%~dp0fusion-addin"
set "TARGET=%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\FusionDock"

echo.
echo   FusionDock
echo   ----------
echo.

if not exist "%SOURCE%" (
    echo   ERROR: cannot find the add-in files.
    echo.
    echo   Looked in: %SOURCE%
    echo.
    echo   This usually means the script was copied out on its own. Run it from inside the
    echo   plugin folder it came in, where the "fusion-addin" folder sits beside it.
    echo.
    pause
    exit /b 1
)

echo   Installing to:
echo   %TARGET%
echo.

rem  config.json (the port) and command_overrides.json are the two files a user may have
rem  edited. xcopy /Y would overwrite both on every reinstall, silently throwing away a port
rem  change, so they are set aside first and put back afterwards.
if exist "%TARGET%\config.json" copy /Y "%TARGET%\config.json" "%TEMP%\fsd_config.bak" >nul
if exist "%TARGET%\command_overrides.json" copy /Y "%TARGET%\command_overrides.json" "%TEMP%\fsd_overrides.bak" >nul

rem  /E all subfolders including empty, /I treat the target as a folder, /Y overwrite without
rem  asking, /Q quiet.
xcopy "%SOURCE%" "%TARGET%" /E /I /Y /Q >nul
if errorlevel 1 (
    echo   ERROR: the copy failed.
    echo.
    echo   If Fusion 360 is open, close it and run this again.
    echo.
    pause
    exit /b 1
)

if exist "%TEMP%\fsd_config.bak" (
    copy /Y "%TEMP%\fsd_config.bak" "%TARGET%\config.json" >nul
    del "%TEMP%\fsd_config.bak" >nul
    echo   Kept your existing config.json.
)
if exist "%TEMP%\fsd_overrides.bak" (
    copy /Y "%TEMP%\fsd_overrides.bak" "%TARGET%\command_overrides.json" >nul
    del "%TEMP%\fsd_overrides.bak" >nul
    echo   Kept your existing command_overrides.json.
)

echo   Done.
echo.
echo   NOW RESTART FUSION 360.
echo.
echo   Fusion only looks for add-ins when it starts, so it will not notice this until you
echo   fully quit and reopen it. Restarting the Stream Dock software is not enough.
echo.
echo   To check it worked: Fusion 360, Utilities, Scripts and Add-Ins, Add-Ins tab.
echo   "FusionDock" should be listed and Running.
echo.
pause
