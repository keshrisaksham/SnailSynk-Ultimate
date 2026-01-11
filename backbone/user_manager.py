# backbone/user_manager.py
import os
import sys
import json
import logging
from pathlib import Path
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

class UserManager:
    """Handles admin user authentication and credential management."""
    def __init__(self, config_path):
        self.config_path = Path(config_path)
        self.config_path.parent.mkdir(exist_ok=True)
        self.ph = PasswordHasher()
        self.user_data = self._load_or_initialize_user()

    def _load_or_initialize_user(self):
        if self.config_path.exists():
            with open(self.config_path, 'r') as f:
                return json.load(f)

        username = os.environ.get('SNAILSYNK_ADMIN_USER')
        password = os.environ.get('SNAILSYNK_ADMIN_PASS')

        if not username or not password:
            logging.warning("Admin user not configured. Run with SNAILSYNK_ADMIN_USER and SNAILSYNK_ADMIN_PASS to create one.")
            return None

        hashed_password = self.ph.hash(password)
        user_data = {'username': username, 'password_hash': hashed_password}

        try:
            with open(self.config_path, 'w') as f:
                json.dump(user_data, f, indent=2)
            logging.info(f"Admin user '{username}' created and saved to {self.config_path}")
            del password
            return user_data
        except Exception as e:
            logging.error(f"FATAL: Could not write admin config file to {self.config_path}: {e}")
            sys.exit(1)

    def verify_password(self, username, password):
        if not self.user_data or self.user_data.get('username') != username:
            return False
        try:
            self.ph.verify(self.user_data['password_hash'], password)
            return True
        except VerifyMismatchError:
            return False
        except Exception as e:
            logging.error(f"An unexpected error occurred during password verification: {e}")
            return False