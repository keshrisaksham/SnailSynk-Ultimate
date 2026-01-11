# backbone/file_manager.py
import os
import io
import json
import base64
import zipfile
import logging
from pathlib import Path
from urllib.parse import quote
from werkzeug.utils import secure_filename
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from .utils import log_history

class FileManager:
    """Handles all file-related operations."""
    def __init__(self, files_folder, instance_path):
        if not files_folder or not os.path.isdir(files_folder):
            raise ValueError("Invalid files_folder provided to FileManager.")
        self.files_folder = files_folder
        self.supported_image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'}

        self.metadata_path = os.path.join(instance_path, 'file_metadata.json')
        self.ph = PasswordHasher()
        self.metadata = self._load_metadata()

    def _load_metadata(self):
        if not os.path.exists(self.metadata_path): return {}
        try:
            with open(self.metadata_path, 'r') as f: return json.load(f)
        except (json.JSONDecodeError, IOError):
            logging.error(f"Could not load or parse file metadata from {self.metadata_path}")
            return {}
        
    def _save_metadata(self):
        try:
            with open(self.metadata_path, 'w') as f: json.dump(self.metadata, f, indent=2)
        except IOError as e: logging.error(f"Could not save file metadata to {self.metadata_path}: {e}")

    def _generate_unique_filename(self, file_path):
        if not os.path.exists(file_path): return file_path
        directory, filename = os.path.split(file_path)
        name, ext = os.path.splitext(filename)
        counter = 1
        while True:
            new_path = os.path.join(directory, f"{name} ({counter}){ext}")
            if not os.path.exists(new_path): return new_path
            counter += 1

    def is_locked(self, filename):
        return filename in self.metadata
    
    def lock_file(self, filename, password):
        if not password: return False, "Password cannot be empty."
        if not os.path.isfile(os.path.join(self.files_folder, filename)): return False, "File not found."
        password_hash = self.ph.hash(password)
        self.metadata[filename] = {'password_hash': password_hash}
        self._save_metadata()
        return True, f"File '{filename}' locked."

    def unlock_file(self, filename):
        if filename in self.metadata:
            del self.metadata[filename]
            self._save_metadata()
            return True, f"File '{filename}' unlocked."
        return False, "File was not locked."
    
    def verify_file_password(self, filename, password):
        if not self.is_locked(filename): return False
        password_hash = self.metadata[filename].get('password_hash')
        try:
            self.ph.verify(password_hash, password)
            return True
        except VerifyMismatchError: return False
        except Exception as e:
            logging.error(f"Error during file password verification for {filename}: {e}")
            return False

    def list_files(self):
        files = []
        try:
            raw_files = os.listdir(self.files_folder)
            file_names = sorted([f for f in raw_files if os.path.isfile(os.path.join(self.files_folder, f)) and not f.startswith('.')])
            for file_name in file_names:
                full_path = os.path.join(self.files_folder, file_name)
                files.append({
                    'name': file_name, 
                    'encoded_name': quote(file_name), 
                    'is_locked': self.is_locked(file_name),
                    'mtime': os.path.getmtime(full_path)
                })
        except Exception as e:
            logging.error(f"Error listing files in {self.files_folder}: {e}")
            raise
        return files

    def save_uploaded_files(self, uploaded_files, remote_addr):
        success_messages, error_messages, uploaded_count = [], [], 0
        ip_color = "yellow" if remote_addr != "1227.0.0.1" else "cyan"
        if not uploaded_files or all(f.filename == '' for f in uploaded_files):
            return [], ['No files selected for uploading.']
        for file in uploaded_files:
            if not file or file.filename == '': continue
            original_filename = file.filename
            if not secure_filename(original_filename):
                error_messages.append(f'Filename "{original_filename}" is not allowed.')
                continue
            unique_path = self._generate_unique_filename(os.path.join(self.files_folder, original_filename))
            final_filename = os.path.basename(unique_path)
            try:
                file.save(unique_path)
                log_history("File Uploaded", f"'{final_filename}' from [{ip_color}]{remote_addr}[/]")
                if final_filename == original_filename: success_messages.append(f'File "{original_filename}" uploaded successfully.')
                else: success_messages.append(f'File "{original_filename}" was renamed to "{final_filename}".')
                uploaded_count += 1
            except Exception as e:
                error_messages.append(f'Error saving file "{original_filename}". Check server logs.')
                logging.error(f'Error saving file {unique_path}: {e}')
        if uploaded_count == 0 and any(f.filename for f in uploaded_files if f):
             error_messages.append('No files were successfully uploaded.')
        return success_messages, error_messages

    def zip_selected_files(self, filenames, remote_addr):
        memory_file, skipped_files = io.BytesIO(), []
        ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for filename in filenames:
                full_path = os.path.join(self.files_folder, filename)
                if os.path.isfile(full_path): zipf.write(full_path, arcname=filename)
                else: skipped_files.append(filename)
        memory_file.seek(0)
        log_history("Files Downloaded", f"'SnailSynk_Selected_Files.zip' by [{ip_color}]{remote_addr}[/]")
        return memory_file, skipped_files

    def delete_file(self, filename, remote_addr):
        if not secure_filename(filename): return False, "Invalid filename provided."
        file_path = os.path.join(self.files_folder, filename)
        if not os.path.abspath(file_path).startswith(os.path.abspath(self.files_folder)):
            return False, "Access denied."
        if not os.path.isfile(file_path): return False, "File not found."
        try:
            os.remove(file_path)
            if self.is_locked(filename): # Also remove from metadata if locked
                del self.metadata[filename]
                self._save_metadata()
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            log_history("File Deleted", f"'{filename}' by [{ip_color}]{remote_addr}[/]")
            return True, f"File '{filename}' was successfully deleted."
        except Exception as e:
            logging.error(f"Error while deleting file {file_path} by {remote_addr}: {e}")
            return False, "An unexpected server error occurred."
        
    def get_image_preview_b64(self, filename):
        _, extension = os.path.splitext(filename)
        if extension.lower() not in self.supported_image_extensions: return None
        file_path = os.path.join(self.files_folder, filename)
        if not os.path.abspath(file_path).startswith(os.path.abspath(self.files_folder)): return None
        if not os.path.isfile(file_path): return None
        try:
            with open(file_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            mime_type = f"image/{extension.lower().lstrip('.').replace('jpg', 'jpeg')}"
            if extension.lower() == '.svg': mime_type = 'image/svg+xml'
            return f"data:{mime_type};base64,{encoded_string}"
        except Exception as e:
            logging.error(f"Could not read and encode image file for preview '{file_path}': {e}")
            return None