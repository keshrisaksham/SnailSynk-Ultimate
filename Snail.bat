@echo off
setlocal enabledelayedexpansion

:: ########## CRITICAL: Set the working directory to the script's location ##########
:: This ensures that whether we are installing or running, all files are found correctly.
pushd "%~dp0"

:: --------------------------------------------------------------------------------
:: PRIMARY LOGIC: Check if setup is needed or if we can just run the app.
:: --------------------------------------------------------------------------------
if exist "install.loc" (
    goto :run_app
) else (
    goto :install_app
)


:: ================================================================================
:: INSTALLATION ROUTINE (This entire section is skipped after first run)
:: ================================================================================
:install_app

:: 1. ADMIN CHECK: This check is now ONLY performed during installation.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrative privileges for one-time setup...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit
)

:: If we are here, we are running as an administrator for the setup process.
cls
echo ======================================================
echo      SNAILSYNC ONE-TIME SETUP UTILITY
echo ======================================================
echo.

:: a. ADD CURRENT DIRECTORY TO PATH
echo [+] Checking and adding the current directory to the PATH...
set "CURRENT_DIR=%cd%"
echo %PATH% | find "%CURRENT_DIR%" >nul
if %errorlevel% neq 0 (
    echo    -> Adding "%CURRENT_DIR%" to user PATH.
    setx PATH "%PATH%;%CURRENT_DIR%" >nul
) else (
    echo    -> Current directory is already in the PATH.
)
echo.

:: b. INSTALL PYTHON DEPENDENCIES
echo [+] Installing Python dependencies from requirements.txt...
if exist "requirements.txt" (
    for /f "delims=" %%i in (requirements.txt) do (
        echo.
        echo --------------------------------------------------
        echo    Installing: %%i
        echo --------------------------------------------------
        pip install "%%i"
    )
    echo.
    echo [+] All dependencies installed successfully.
) else (
    echo [!] ERROR: requirements.txt not found. Cannot install dependencies.
    pause
    exit
)
echo.

:: c. & d. CREATE AND POPULATE .ENV FILE
echo [+] Creating .env configuration file...
set /p "ADMIN_USER=   -> Enter your admin username: "
set /p "ADMIN_PASS=   -> Enter a secure password: "
set /p "FLASK_SECRET= -> Enter a random string for the Flask secret key: "
set /p "GEMINI_KEY=   -> Enter your Gemini API key (or press Enter to skip): "
set /p "APP_PORT=     -> Enter the port number (default: 9000, press Enter to skip): "

:: Set default port if empty
if "!APP_PORT!"=="" set "APP_PORT=9000"

(
    echo SNAILSYNK_ADMIN_USER="!ADMIN_USER!"
    echo SNAILSYNK_ADMIN_PASS="!ADMIN_PASS!"
    echo FLASK_SECRET_KEY="!FLASK_SECRET!"
    echo GEMINI_API_KEY="!GEMINI_KEY!"
    echo SNAILSYNK_PORT=!APP_PORT!
) > .env

echo [+] .env file created successfully.
echo.

:: e. CREATE INSTALL.LOC FILE
echo [+] Finalizing installation...
echo Installation completed on %date% at %time% > install.loc
echo.

:: f. CREATE DESKTOP SHORTCUT
echo [+] Creating desktop shortcut...
set "SHORTCUT_NAME=SnailSynk"
set "TARGET_PATH=%~f0"
set "ICON_PATH=%cd%\essentials\icon.ico"
set "DESKTOP_PATH=%USERPROFILE%\Desktop"
set "VBS_SCRIPT=%TEMP%\create_shortcut.vbs"

(
    echo Set oWS = WScript.CreateObject("WScript.Shell"^)
    echo sLinkFile = "%DESKTOP_PATH%\%SHORTCUT_NAME%.lnk"
    echo Set oLink = oWS.CreateShortcut(sLinkFile^)
    echo oLink.TargetPath = "%TARGET_PATH%"
    echo oLink.WorkingDirectory = "%cd%"
    echo oLink.IconLocation = "%ICON_PATH%"
    echo oLink.Save
) > "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%" >nul
del "%VBS_SCRIPT%"
echo [+] Shortcut created on your desktop.
echo.
echo ======================================================
echo      SETUP COMPLETE! The application will now start.
echo ======================================================
echo.
pause
goto :run_app


:: ================================================================================
:: APPLICATION LAUNCH ROUTINE (Runs as a Standard User)
:: ================================================================================
:run_app
cls
echo Starting SnailSynk Application...

:: Read port from .env file (default to 9000 if not found)
set "LAUNCH_PORT=9000"
for /f "tokens=1,* delims==" %%a in ('findstr /b "SNAILSYNK_PORT" .env 2^>nul') do (
    set "LAUNCH_PORT=%%b"
)

:: Open browser after a short delay (start in background)
start "" "http://localhost:%LAUNCH_PORT%"

:: Start the Python application
python SnailSynk.py

:: Clean up by restoring the original directory and exiting.
popd
pause
exit /b