# backbone/action_logger.py
import json
import logging
from pathlib import Path
from datetime import datetime, timezone

class ActionLogger:
    """Handles writing and reading structured action logs with real-time emission."""
    def __init__(self, log_file_path, socketio=None):
        self.path = Path(log_file_path)
        self.socketio = socketio
        if not self.path.exists():
            self.path.touch()

    def _emit_log(self, log_entry):
        if self.socketio:
            self.socketio.emit('new_log_entry', log_entry, room='admin_room')

    def log(self, ip, action, details=None):
        log_entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'ip_address': ip, 'action': action, 'details': details or {}
        }
        try:
            with open(self.path, 'a') as f:
                f.write(json.dumps(log_entry) + '\n')
            self._emit_log(log_entry)
        except IOError as e:
            logging.error(f"Failed to write to action log at {self.path}: {e}")

    def get_logs(self, page=1, limit=10):
        try:
            with open(self.path, 'r') as f: lines = f.readlines()
            lines.reverse()
            start_index = (page - 1) * limit
            end_index = start_index + limit
            paginated_lines = lines[start_index:end_index]
            logs = [json.loads(line) for line in paginated_lines]
            has_more = len(lines) > end_index
            return logs, has_more
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Failed to read action log from {self.path}: {e}")
            return [], False

    def get_all_logs(self):
        """Get all logs without pagination for statistics."""
        try:
            with open(self.path, 'r') as f:
                lines = f.readlines()
            logs = [json.loads(line) for line in lines if line.strip()]
            return logs
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Failed to read action log from {self.path}: {e}")
            return []

    def clear_logs(self):
        """Clear all action logs."""
        try:
            with open(self.path, 'w') as f:
                f.write('')
            logging.info(f"Cleared all logs from {self.path}")
        except IOError as e:
            logging.error(f"Failed to clear logs from {self.path}: {e}")

    def migrate_old_logs(self):
        """Migrate old logs from 'ip' field to 'ip_address' field."""
        try:
            with open(self.path, 'r') as f:
                lines = f.readlines()
            
            migrated_lines = []
            migrated_count = 0
            
            for line in lines:
                if line.strip():
                    try:
                        log_entry = json.loads(line)
                        # If old format with 'ip' field, migrate to 'ip_address'
                        if 'ip' in log_entry and 'ip_address' not in log_entry:
                            log_entry['ip_address'] = log_entry.pop('ip')
                            migrated_count += 1
                        migrated_lines.append(json.dumps(log_entry) + '\n')
                    except json.JSONDecodeError:
                        # Keep invalid lines as-is
                        migrated_lines.append(line)
            
            # Write back migrated logs
            if migrated_count > 0:
                with open(self.path, 'w') as f:
                    f.writelines(migrated_lines)
                logging.info(f"Migrated {migrated_count} log entries from 'ip' to 'ip_address' field")
            
            return migrated_count
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Failed to migrate logs from {self.path}: {e}")
            return 0