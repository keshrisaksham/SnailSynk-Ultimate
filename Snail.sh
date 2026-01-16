#!/bin/bash

# ================================================================================
# SnailSynk Environment Setup Script for Linux & macOS
# ================================================================================

# Stop the script if any command fails
set -e

# --- CRITICAL: Change to the script's directory ---
# This ensures that all file operations (finding requirements.txt, creating .env)
# happen in the correct location, regardless of where the script is called from.
cd "$(dirname "$0")"

# --- Function to display a formatted header ---
print_header() {
    echo "======================================================"
    echo "  $1"
    echo "======================================================"
    echo
}

# ================================================================================
# SETUP ROUTINE (This entire section is skipped after first run)
# ================================================================================
setup_routine() {

    # --- 1. ADMIN/ROOT CHECK (using sudo) ---
    # On Linux/macOS, we check for an effective user ID of 0.
    if [ "$EUID" -ne 0 ]; then
        echo "Requesting administrator privileges for one-time setup..."
        # Re-run this script with sudo, passing an argument to prevent an infinite loop.
        sudo bash "$0" --run-setup
        exit
    fi

    clear
    print_header "SNAILSYNC ONE-TIME SETUP UTILITY"

    # --- Check for Python3 and Pip ---
    echo "[+] Checking for dependencies..."
    if ! command -v python3 &> /dev/null; then
        echo "[!] ERROR: python3 is not installed. Please install it to continue."
        exit 1
    fi
    if ! command -v pip3 &> /dev/null; then
         echo "[!] ERROR: pip3 is not installed. Please install it (e.g., 'sudo apt install python3-pip') to continue."
        exit 1
    fi
     echo "   -> Python 3 and Pip found."
    echo

    # --- a. Create a launch command in /usr/local/bin ---
    # This is the standard Unix/Linux equivalent of adding to PATH. It makes the
    # script runnable from anywhere in the terminal.
    echo "[+] Creating system-wide launch command..."
    # Get the absolute path to the main python script
    SNAILSYNK_PY_PATH="$(pwd)/SnailSynk.py"
    # Create a simple launcher script
    # The '#!/bin/bash' and 'cd' lines ensure it runs from the correct directory
    cat << EOF > /usr/local/bin/snailsynk
#!/bin/bash
cd "$(dirname "$SNAILSYNK_PY_PATH")"
python3 "$SNAILSYNK_PY_PATH"
EOF
    # Make the launcher executable
    chmod +x /usr/local/bin/snailsynk
    echo "   -> You can now run the application from any terminal by typing: snailsynk"
    echo

    # --- b. INSTALL PYTHON DEPENDENCIES ---
    echo "[+] Installing Python dependencies from requirements.txt..."
    if [ -f "requirements.txt" ]; then
        # Use pip3 to be explicit. Read each line from the file.
        while IFS= read -r package || [ -n "$package" ]; do
            if [ -n "$package" ]; then # ensure the line is not empty
                echo
                echo "--------------------------------------------------"
                echo "   Installing: $package"
                echo "--------------------------------------------------"
                pip3 install "$package" --break-system-packages
            fi
        done < "requirements.txt"
        echo
        echo "[+] All dependencies installed successfully."
    else
        echo "[!] ERROR: requirements.txt not found. Cannot install dependencies."
        exit 1
    fi
    echo

    # --- c. & d. CREATE AND POPULATE .ENV FILE ---
    echo "[+] Creating .env configuration file..."
    read -p "   -> Enter your admin username: " ADMIN_USER
    read -sp "  -> Enter a secure password: " ADMIN_PASS
    echo "" # Newline after hidden password input
    read -p "   -> Enter a random string for the Flask secret key: " FLASK_SECRET
    read -p "   -> Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
    read -p "   -> Enter the port number (default: 9000, press Enter to skip): " APP_PORT

    # Set default port if empty
    if [ -z "$APP_PORT" ]; then
        APP_PORT="9000"
    fi

    # Use a "Here Document" to write the .env file
    cat > .env << EOF
SNAILSYNK_ADMIN_USER="${ADMIN_USER}"
SNAILSYNK_ADMIN_PASS="${ADMIN_PASS}"
FLASK_SECRET_KEY="${FLASK_SECRET}"
GEMINI_API_KEY="${GEMINI_KEY}"
SNAILSYNK_PORT=${APP_PORT}
EOF

    echo "[+] .env file created successfully."
    echo

    # --- e. CREATE INSTALL.LOC FILE ---
    echo "[+] Finalizing installation..."
    echo "Installation completed on $(date)" > install.loc
    echo

    print_header "SETUP COMPLETE! The application will now start."
    read -p "Press [Enter] to continue..."
}

# ================================================================================
# APPLICATION LAUNCH ROUTINE
# ================================================================================
launch_routine() {
    clear
    print_header "Starting SnailSynk Application"
    
    # Read port from .env file (default to 9000 if not found)
    LAUNCH_PORT="9000"
    if [ -f ".env" ]; then
        PORT_LINE=$(grep "^SNAILSYNK_PORT" .env 2>/dev/null)
        if [ -n "$PORT_LINE" ]; then
            LAUNCH_PORT=$(echo "$PORT_LINE" | cut -d'=' -f2)
        fi
    fi
    
    # Open browser in background (after a short delay to let server start)
    (sleep 2 && {
        if command -v xdg-open &> /dev/null; then
            xdg-open "http://localhost:$LAUNCH_PORT" &> /dev/null
        elif command -v open &> /dev/null; then
            open "http://localhost:$LAUNCH_PORT"
        fi
    }) &
    
    # Start the Python application
    python3 SnailSynk.py
}


# ================================================================================
#                                 MAIN LOGIC
# ================================================================================
# If the script is re-run with sudo and the '--run-setup' flag, just run setup.
if [ "$1" == "--run-setup" ]; then
    setup_routine
    launch_routine
    exit
fi

# Standard script execution: check if setup is needed.
if [ -f "install.loc" ]; then
    launch_routine
else
    setup_routine
    launch_routine
fi
