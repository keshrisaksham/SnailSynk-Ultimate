# backbone/content_manager.py
import logging
from datetime import datetime
from .utils import log_history, PYCLIP_AVAILABLE

if PYCLIP_AVAILABLE:
    import pyperclip

class ContentManager:
    """Manages all text content: the shared buffer and pinned messages."""
    def __init__(self, pin_limit=5):
        self.shared_text = ""
        self.pins = []
        self.limit = pin_limit

    def get_shared_text(self): return self.shared_text

    def update_shared_text(self, new_text, remote_addr):
        self.shared_text = str(new_text)
        ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
        details = f"by [{ip_color}]{remote_addr}[/], length: {len(self.shared_text)}"
        log_history("Buffer Cleared" if not self.shared_text else "Buffer Updated", details)
        return self.shared_text

    def copy_buffer_to_clipboard(self):
        if not PYCLIP_AVAILABLE:
            msg = "Clipboard functionality unavailable on server (pyperclip not installed)."
            return False, msg
        try:
            pyperclip.copy(self.shared_text)
            return True, "Text copied to server clipboard."
        except Exception as e:
            logging.error(f"Failed to copy text to server clipboard: {e}")
            return False, str(e)

    def get_pins(self): return self.pins

    def add_pin(self, text, remote_addr):
        if len(self.pins) >= self.limit: return None, f"Pin limit of {self.limit} reached."
        if not text or not text.strip(): return None, "Cannot pin empty text."
        new_pin = {'id': str(datetime.now().timestamp()), 'text': text}
        self.pins.append(new_pin)
        ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
        log_history("Message Pinned", f"ID: {new_pin['id']} from [{ip_color}]{remote_addr}[/]")
        return self.pins, None

    def delete_pin(self, pin_id, remote_addr):
        original_count = len(self.pins)
        self.pins = [pin for pin in self.pins if pin.get('id') != pin_id]
        if len(self.pins) < original_count:
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            log_history("Message Unpinned", f"ID: {pin_id} by [{ip_color}]{remote_addr}[/]")
            return self.pins, None
        else:
            return None, "Pin not found."