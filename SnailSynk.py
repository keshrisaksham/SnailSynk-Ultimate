import os
import sys
import logging
from pathlib import Path
from datetime import timedelta

# --- Third-Party Imports ---
from dotenv import load_dotenv
from flask import Flask, request, session, render_template
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.logging import RichHandler
from rich.rule import Rule

# --- Application Imports ---
from backbone import (FileManager, ContentManager, UserManager, BlocklistManager, 
                      ActionLogger, log_history, PYCLIP_AVAILABLE, NotesManager)

from routes import admin_bp, main_bp, ai_chat_bp
from routes.routes_admin import init_admin_routes
from routes.routes_index import init_index_routes, register_socketio_events
from routes.routes_ai_chat import init_ai_chat_routes
from routes.utils import get_local_ip
from routes.ssl_utils import ensure_ssl_cert

# --- Initial Setup ---
load_dotenv()
console = Console()
logging.basicConfig(level=logging.INFO)
logging.getLogger('werkzeug').setLevel(logging.WARNING)

# --- Suppress SSL Handshake Errors ---
# Self-signed certs cause noisy SSL tracebacks when browsers first connect.
# This filter buffers tracebacks and drops them if they contain SSL errors.
import sys as _sys

class _SSLStderrFilter:
    def __init__(self, stream):
        self._stream = stream
        self._buffer = []
        self._buffering = False

    def write(self, text):
        # Start buffering when a traceback begins
        if 'Traceback (most recent call last)' in text:
            self._buffering = True
            self._buffer = [text]
            return len(text)
        
        if self._buffering:
            self._buffer.append(text)
            # Check if this line ends the traceback (an exception line)
            stripped = text.strip()
            if stripped and not stripped.startswith('File ') and not stripped.startswith('return ') and not stripped.startswith('result ') and not stripped.startswith('read ') and not stripped.startswith('line ') and not stripped.startswith('self.') and not stripped.startswith('super()') and not stripped.startswith('listeners') and not stripped == '~~' and not text.startswith(' ') and not text.startswith('\t') and 'Error' in stripped:
                self._buffering = False
                # Check if any buffered line contains SSL error
                full_text = ''.join(self._buffer)
                if 'SSLV3_ALERT' in full_text or 'CERTIFICATE_UNKNOWN' in full_text or ('ssl.SSLError' in full_text and 'alert' in full_text):
                    self._buffer = []
                    return len(text)
                # Not an SSL error — flush the buffer
                for line in self._buffer:
                    self._stream.write(line)
                self._buffer = []
                return len(text)
            return len(text)
        
        # Also suppress "Removing descriptor" lines that follow SSL errors
        if 'Removing descriptor' in text:
            return len(text)
        
        return self._stream.write(text)

    def flush(self):
        self._stream.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)

_sys.stderr = _SSLStderrFilter(_sys.stderr)
history_logger = logging.getLogger('history')
history_logger.setLevel(logging.INFO)
history_logger.addHandler(RichHandler(console=console, show_path=False, show_level=False, show_time=True, markup=True))
history_logger.propagate = False

# --- Directory and Path Setup ---
APP_DIR_NAME = "SnailSynk"
FILES_SUBDIR_NAME = "files"
try:
    downloads_dir = Path.home() / "Downloads"
    files_folder_path = downloads_dir / APP_DIR_NAME / FILES_SUBDIR_NAME
    files_folder_path.mkdir(parents=True, exist_ok=True)
except Exception as e:
    console.log(f"[bold red]FATAL: Could not create app directory: {e}[/bold red]")
    sys.exit(1)

# --- App Configuration & Initialization ---
app = Flask(__name__, instance_relative_config=True)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24))
app.config['FILES_FOLDER'] = str(files_folder_path)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=1)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
socketio = SocketIO(app)
socketio.active_clients = {}

# --- Initialize Managers ---
file_manager = FileManager(app.config['FILES_FOLDER'], app.instance_path)
content_manager = ContentManager()
user_manager = UserManager(os.path.join(app.instance_path, 'user.json'))
blocklist_manager = BlocklistManager(os.path.join(app.instance_path, 'blocklist.json'))
action_logger = ActionLogger(os.path.join(app.instance_path, 'actions.jsonl'), socketio=socketio)
notes_manager = NotesManager(os.path.join(app.instance_path, 'notes'))

# Migrate old log entries from 'ip' to 'ip_address' field
migrated_count = action_logger.migrate_old_logs()
if migrated_count > 0:
    console.log(f"[bold green]Migrated {migrated_count} log entries to new format[/bold green]")

# --- Initialize and Register Blueprints ---
init_admin_routes(user_manager, socketio, blocklist_manager, action_logger, notes_manager)
init_index_routes(file_manager, content_manager, action_logger, socketio)
init_ai_chat_routes(action_logger)

app.register_blueprint(admin_bp)
app.register_blueprint(main_bp)
app.register_blueprint(ai_chat_bp)

# --- Register SocketIO Events ---
register_socketio_events(socketio)

# --- App-level Request Hooks ---
@app.before_request
def before_request_handler():
    # Blocklist Check
    if not request.path.startswith('/static') and request.remote_addr != '127.0.0.1':
        if blocklist_manager.is_blocked(request.remote_addr):
            return render_template('error.html', error_code=403, error_title="Forbidden", error_description="Your IP address has been banned by the administrator."), 403
    
    # Page Access Logging
    ignored_paths = ('/static/', '/api/', '/favicon.ico', '/socket.io/', '/admin/api/')
    if request.path.startswith(ignored_paths): return
    remote_ip = request.remote_addr
    ip_color = "yellow" if remote_ip != "127.0.0.1" else "cyan"
    log_history("Page Accessed", f"from [{ip_color}]{remote_ip}[/] -> {request.path}")
    action_logger.log(remote_ip, 'PAGE_VIEW', {'path': request.path})

# --- Centralized Error Handling ---
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(e):
    """Renders the custom error page for specified HTTP errors."""
    error_code = e.code if hasattr(e, 'code') else 500
    
    error_details = {
        403: {
            "title": "Forbidden",
            "description": "You do not have permission to access this page. Please check your credentials."
        },
        404: {
            "title": "Page Not Found",
            "description": "The page you are looking for does not exist. It might have been moved or deleted."
        },
        500: {
            "title": "Internal Server Error",
            "description": "Something went wrong on our end. We are working to fix the issue."
        }
    }

    details = error_details.get(error_code, error_details[500]) # Default to 500 for other errors

    return render_template(
        'error.html', 
        error_code=error_code, 
        error_title=details["title"],
        error_description=details["description"]
    ), error_code

# --- Main Execution ---
if __name__ == '__main__':
    APP_PORT = int(os.environ.get('SNAILSYNK_PORT', 9000))
    local_ip = get_local_ip()
    
    # Generate or load SSL certificate
    certfile, keyfile = ensure_ssl_cert(app.instance_path)
    
    clipboard_status = (
        Text("Enabled", style="bold green") if PYCLIP_AVAILABLE 
        else Text("Disabled (pyperclip not installed)", style="bold yellow")
    )
    
    info_text = Text(justify="center")
    info_text.append("© 2026 YawnByte. All rights reserved.\n", style="bright_black")
    info_text.append("Clipboard Support: ", style="default")
    info_text.append(clipboard_status)
    info_text.append("\n")
    info_text.append("HTTPS: ", style="default")
    info_text.append("Enabled (Self-Signed)", style="bold green")

    panel_content = f"""
[bold]Access from this computer:[/] [cyan]https://localhost:{APP_PORT}[/]
[bold]Access from other devices:[/] [cyan]https://{local_ip}:{APP_PORT}[/]
    """

    console.print(Panel(info_text, title="[bold #946eeA]SnailSynk[/]", subtitle="[#9e82b4]v2.0[/]", border_style="magenta"))
    console.print(Panel(panel_content.strip(), title="[bold #62A0EA]Access Points[/]", border_style="blue"))
    console.print(Rule("[bold white]Application Log[/]", style="white"))

    socketio.run(app, host='0.0.0.0', port=APP_PORT, certfile=certfile, keyfile=keyfile)