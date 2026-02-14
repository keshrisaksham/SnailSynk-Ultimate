# backbone/file_manager.py
import os
import io
import json
import shutil
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

    def _validate_subpath(self, subpath):
        """Validate and resolve a subpath within files_folder. Returns the absolute path or raises ValueError."""
        if not subpath:
            return self.files_folder
        # Normalize and reject any component that tries to escape
        normalized = os.path.normpath(subpath)
        if normalized.startswith('..') or os.path.isabs(normalized):
            raise ValueError("Invalid path.")
        # Check each component is safe
        for part in Path(normalized).parts:
            if part in ('.', '..') or not part.strip():
                raise ValueError("Invalid path component.")
        full_path = os.path.join(self.files_folder, normalized)
        # Final check: resolved path must be inside files_folder
        if not os.path.abspath(full_path).startswith(os.path.abspath(self.files_folder)):
            raise ValueError("Access denied.")
        return full_path

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

    def list_files(self, subpath=''):
        """List files and folders in the given subpath."""
        items = []
        try:
            target_dir = self._validate_subpath(subpath)
            if not os.path.isdir(target_dir):
                return items
            raw_entries = os.listdir(target_dir)
            entries = sorted([e for e in raw_entries if not e.startswith('.')], key=str.lower)
            # Folders first, then files
            folders = []
            files = []
            for entry in entries:
                full_path = os.path.join(target_dir, entry)
                # Build the relative path from files_folder root for encoded_name
                rel_path = os.path.join(subpath, entry) if subpath else entry
                if os.path.isdir(full_path):
                    folders.append({
                        'name': entry,
                        'encoded_name': quote(rel_path),
                        'type': 'folder',
                        'is_locked': self.is_folder_locked(rel_path),
                        'mtime': os.path.getmtime(full_path)
                    })
                elif os.path.isfile(full_path):
                    files.append({
                        'name': entry,
                        'encoded_name': quote(rel_path),
                        'type': 'file',
                        'is_locked': self.is_locked(rel_path),
                        'mtime': os.path.getmtime(full_path)
                    })
            items = folders + files
        except ValueError as e:
            logging.warning(f"Invalid subpath requested: {subpath} - {e}")
        except Exception as e:
            logging.error(f"Error listing files in {self.files_folder}/{subpath}: {e}")
            raise
        return items

    def save_uploaded_files(self, uploaded_files, remote_addr, subpath='', is_admin=False):
        success_messages, error_messages, uploaded_count = [], [], 0
        ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
        if not uploaded_files or all(f.filename == '' for f in uploaded_files):
            return [], ['No files selected for uploading.']
        try:
            target_dir = self._validate_subpath(subpath)
        except ValueError:
            return [], ['Invalid upload directory.']
        if not os.path.isdir(target_dir):
            return [], ['Upload directory does not exist.']
        # Non-admin users cannot upload to locked folders
        if not is_admin and self.is_folder_locked(subpath):
            return [], ['This folder is locked. Only admins can upload here.']
        for file in uploaded_files:
            if not file or file.filename == '': continue
            original_filename = file.filename
            if not secure_filename(original_filename):
                error_messages.append(f'Filename "{original_filename}" is not allowed.')
                continue
            unique_path = self._generate_unique_filename(os.path.join(target_dir, original_filename))
            final_filename = os.path.basename(unique_path)
            try:
                file.save(unique_path)
                display_path = f"{subpath}/{final_filename}" if subpath else final_filename
                log_history("File Uploaded", f"'{display_path}' from [{ip_color}]{remote_addr}[/]")
                if final_filename == original_filename: success_messages.append(f'File "{original_filename}" uploaded successfully.')
                else: success_messages.append(f'File "{original_filename}" was renamed to "{final_filename}".')
                uploaded_count += 1
            except Exception as e:
                error_messages.append(f'Error saving file "{original_filename}". Check server logs.')
                logging.error(f'Error saving file {unique_path}: {e}')
        if uploaded_count == 0 and any(f.filename for f in uploaded_files if f):
             error_messages.append('No files were successfully uploaded.')
        return success_messages, error_messages

    def move_file(self, filename, source_path, dest_path, remote_addr):
        """Move a file from source_path to dest_path. Both are relative subpaths."""
        try:
            source_dir = self._validate_subpath(source_path)
            dest_dir = self._validate_subpath(dest_path)
        except ValueError:
            return False, "Invalid path."
        source_file = os.path.join(source_dir, filename)
        if not os.path.isfile(source_file):
            return False, f"File '{filename}' not found in source."
        if not os.path.isdir(dest_dir):
            return False, "Destination folder does not exist."
        dest_file = self._generate_unique_filename(os.path.join(dest_dir, filename))
        try:
            shutil.move(source_file, dest_file)
            # Update metadata (lock info) if the file was locked
            old_rel = os.path.join(source_path, filename) if source_path else filename
            new_rel = os.path.join(dest_path, os.path.basename(dest_file)) if dest_path else os.path.basename(dest_file)
            if old_rel in self.metadata:
                self.metadata[new_rel] = self.metadata.pop(old_rel)
                self._save_metadata()
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            log_history("File Moved", f"'{old_rel}' -> '{new_rel}' by [{ip_color}]{remote_addr}[/]")
            return True, f"File '{filename}' moved successfully."
        except Exception as e:
            logging.error(f"Error moving file {source_file} to {dest_file}: {e}")
            return False, "An unexpected server error occurred."

    def list_all_folders(self, base_path=''):
        """Recursively list all folder paths relative to files_folder root."""
        folders = [{'path': '', 'name': 'Root'}]
        def _walk(rel_path):
            try:
                target_dir = self._validate_subpath(rel_path)
            except ValueError:
                return
            if not os.path.isdir(target_dir):
                return
            try:
                for entry in sorted(os.listdir(target_dir), key=str.lower):
                    if entry.startswith('.'):
                        continue
                    full = os.path.join(target_dir, entry)
                    if os.path.isdir(full):
                        child_rel = os.path.join(rel_path, entry) if rel_path else entry
                        folders.append({'path': child_rel, 'name': child_rel})
                        _walk(child_rel)
            except Exception as e:
                logging.error(f"Error walking folders in {target_dir}: {e}")
        _walk(base_path)
        return folders

    # --- Folder Locking ---
    def is_folder_locked(self, subpath):
        """Check if a folder is locked. Uses metadata key 'folder:<subpath>'."""
        if not subpath:
            return False  # Root folder can never be locked
        key = f"folder:{subpath}"
        return key in self.metadata

    def lock_folder(self, subpath, password):
        """Lock a folder with a password so non-admin users cannot upload to it."""
        if not subpath:
            return False, "Cannot lock the root folder."
        if not password:
            return False, "Password cannot be empty."
        try:
            self._validate_subpath(subpath)
        except ValueError:
            return False, "Invalid path."
        key = f"folder:{subpath}"
        password_hash = self.ph.hash(password)
        self.metadata[key] = {'locked': True, 'password_hash': password_hash}
        self._save_metadata()
        return True, f"Folder '{subpath}' locked."

    def unlock_folder(self, subpath, password):
        """Unlock a folder by verifying its password."""
        if not subpath:
            return False, "Root folder is always unlocked."
        if not password:
            return False, "Password cannot be empty."
        key = f"folder:{subpath}"
        if key not in self.metadata:
            return False, "Folder was not locked."
        if not self.verify_folder_password(subpath, password):
            return False, "Incorrect password."
        del self.metadata[key]
        self._save_metadata()
        return True, f"Folder '{subpath}' unlocked."

    def verify_folder_password(self, subpath, password):
        """Verify a folder's lock password."""
        key = f"folder:{subpath}"
        if key not in self.metadata:
            return False
        password_hash = self.metadata[key].get('password_hash')
        if not password_hash:
            return False
        try:
            self.ph.verify(password_hash, password)
            return True
        except VerifyMismatchError:
            return False
        except Exception as e:
            logging.error(f"Error during folder password verification for {subpath}: {e}")
            return False

    def zip_selected_files(self, filenames, remote_addr, subpath=''):
        memory_file, skipped_files = io.BytesIO(), []
        ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
        try:
            target_dir = self._validate_subpath(subpath)
        except ValueError:
            return io.BytesIO(), filenames
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for filename in filenames:
                full_path = os.path.join(target_dir, filename)
                if os.path.isfile(full_path): zipf.write(full_path, arcname=filename)
                else: skipped_files.append(filename)
        memory_file.seek(0)
        log_history("Files Downloaded", f"'SnailSynk_Selected_Files.zip' by [{ip_color}]{remote_addr}[/]")
        return memory_file, skipped_files

    def delete_file(self, filepath, remote_addr):
        """Delete a file. filepath is relative to files_folder (e.g. 'subfolder/file.txt')."""
        # Resolve and validate path
        file_path = os.path.join(self.files_folder, os.path.normpath(filepath))
        if not os.path.abspath(file_path).startswith(os.path.abspath(self.files_folder)):
            return False, "Access denied."
        if not os.path.isfile(file_path): return False, "File not found."
        filename = os.path.basename(filepath)
        if not secure_filename(filename): return False, "Invalid filename provided."
        try:
            os.remove(file_path)
            # Check metadata with the full relative path
            if filepath in self.metadata:
                del self.metadata[filepath]
                self._save_metadata()
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            display_name = filepath
            log_history("File Deleted", f"'{display_name}' by [{ip_color}]{remote_addr}[/]")
            return True, f"File '{display_name}' was successfully deleted."
        except Exception as e:
            logging.error(f"Error while deleting file {file_path} by {remote_addr}: {e}")
            return False, "An unexpected server error occurred."

    def create_folder(self, subpath, folder_name, remote_addr):
        """Create a new folder inside the given subpath."""
        safe_name = secure_filename(folder_name)
        if not safe_name:
            return False, "Invalid folder name."
        try:
            target_dir = self._validate_subpath(subpath)
        except ValueError:
            return False, "Invalid path."
        new_folder_path = os.path.join(target_dir, safe_name)
        if not os.path.abspath(new_folder_path).startswith(os.path.abspath(self.files_folder)):
            return False, "Access denied."
        if os.path.exists(new_folder_path):
            return False, f"A folder named '{safe_name}' already exists."
        try:
            os.makedirs(new_folder_path)
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            display_path = f"{subpath}/{safe_name}" if subpath else safe_name
            log_history("Folder Created", f"'{display_path}' by [{ip_color}]{remote_addr}[/]")
            return True, f"Folder '{safe_name}' created successfully."
        except Exception as e:
            logging.error(f"Error creating folder {new_folder_path}: {e}")
            return False, "An unexpected server error occurred."

    def delete_folder(self, subpath, folder_name, remote_addr):
        """Recursively delete a folder. Admin only."""
        safe_name = secure_filename(folder_name)
        if not safe_name:
            return False, "Invalid folder name."
        try:
            target_dir = self._validate_subpath(subpath)
        except ValueError:
            return False, "Invalid path."
        folder_path = os.path.join(target_dir, safe_name)
        if not os.path.abspath(folder_path).startswith(os.path.abspath(self.files_folder)):
            return False, "Access denied."
        if not os.path.isdir(folder_path):
            return False, "Folder not found."
        try:
            shutil.rmtree(folder_path)
            ip_color = "yellow" if remote_addr != "127.0.0.1" else "cyan"
            display_path = f"{subpath}/{safe_name}" if subpath else safe_name
            log_history("Folder Deleted", f"'{display_path}' by [{ip_color}]{remote_addr}[/]")
            return True, f"Folder '{safe_name}' deleted successfully."
        except Exception as e:
            logging.error(f"Error deleting folder {folder_path}: {e}")
            return False, "An unexpected server error occurred."
        
    def get_image_preview_b64(self, filepath):
        """filepath is relative to files_folder (e.g. 'subfolder/image.png')."""
        _, extension = os.path.splitext(filepath)
        if extension.lower() not in self.supported_image_extensions: return None
        file_path = os.path.join(self.files_folder, os.path.normpath(filepath))
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