# backbone/utils.py
import logging

try:
    import pyperclip
    PYCLIP_AVAILABLE = True
except ImportError:
    PYCLIP_AVAILABLE = False

history_logger = logging.getLogger('history')
last_log_action = None

def log_history(action, details):
    """
    Logs an action to the terminal history, adding a divider
    only when the action type changes.
    """
    global last_log_action
    
    action_colors = {
        "File Uploaded": "green",
        "File Downloaded": "cyan",
        "Files Downloaded": "cyan",
        "File Deleted": "red",
        "Page Accessed": "magenta",
        "Client Connected": "bright_blue",
        "Buffer Cleared": "yellow",
        "Buffer Updated": "yellow",
        "Message Pinned": "blue",
        "Message Unpinned": "red",
        "IP Blocked": "red",
        "IP Unblocked": "green",
    }
    action_color = action_colors.get(action, "white")

    if action != last_log_action:
        if last_log_action is not None:
            history_logger.info("[dim]----------------------------------------------------[/dim]")
        last_log_action = action
        
    action_str = f"[{action_color}]{action}:[/]".ljust(32)
    log_message = f"{action_str} {details}"
    history_logger.info(log_message)