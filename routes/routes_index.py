# routes/routes-index.py
import os
import logging
from flask import (Blueprint, request, redirect, url_for, render_template,
                   send_from_directory, send_file, flash, jsonify, Response, session)
from flask_socketio import emit, join_room
from urllib.parse import unquote
from datetime import datetime, timezone

from qr_gen import generate_custom_qr_svg
from .utils import get_local_ip, get_current_ssid

main_bp = Blueprint('main', __name__, template_folder='../templates')

# Managers will be initialized by the main app
file_manager, content_manager, action_logger, socketio = None, None, None, None

def init_index_routes(fm, cm, al, sio):
    """Initialize the blueprint with managers from the main app."""
    global file_manager, content_manager, action_logger, socketio
    file_manager, content_manager, action_logger, socketio = fm, cm, al, sio

@main_bp.route('/')
def index():
    try: files = file_manager.list_files()
    except Exception:
        files = []
        flash("Error listing files. Check server logs for details.", "error")
    is_admin = session.get('admin_logged_in', False)
    return render_template('index.html', files=files, server_ip=get_local_ip(), current_ssid=get_current_ssid(), is_admin=is_admin)

@main_bp.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files or not request.files.getlist('file'):
        return jsonify(success=False, error="No file part in the request."), 400

    uploaded_files = request.files.getlist('file')
    subpath = request.form.get('subpath', '')
    is_admin = session.get('admin_logged_in', False)
    success_msgs, error_msgs = file_manager.save_uploaded_files(uploaded_files, request.remote_addr, subpath=subpath, is_admin=is_admin)

    if success_msgs:
        action_logger.log(request.remote_addr, 'FILE_UPLOAD', {'files': [f.filename for f in uploaded_files if f.filename], 'path': subpath})
        # After a successful upload, broadcast for the uploaded path
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to get updated file list after upload: {e}")

    return jsonify(success=True, messages={'success': success_msgs, 'error': error_msgs})

@main_bp.route('/files/<path:filename>', methods=['GET'])
def download_file(filename):
    decoded_filename = unquote(filename)
    action_logger.log(request.remote_addr, 'FILE_DOWNLOAD', {'file': decoded_filename})
    return send_from_directory(file_manager.files_folder, decoded_filename, as_attachment=True)

@main_bp.route('/delete/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    decoded_filename = unquote(filename)
    # Determine the parent subpath for broadcasting
    parts = decoded_filename.replace('\\', '/').rsplit('/', 1)
    subpath = parts[0] if len(parts) > 1 else ''
    success, message = file_manager.delete_file(decoded_filename, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FILE_DELETE', {'file': decoded_filename})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to get updated file list after delete: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 404

@main_bp.route('/download_selected', methods=['POST'])
def download_selected_files():
    selected_filenames = request.form.getlist('selected_files')
    subpath = request.form.get('subpath', '')
    if not selected_filenames:
        flash("No files selected for download.", "warning")
        return redirect(url_for('.index'))
    try:
        memory_file, skipped = file_manager.zip_selected_files(selected_filenames, request.remote_addr, subpath=subpath)
        for filename in skipped:
            flash(f"Warning: File '{filename}' was not found and was skipped.", "warning")
        action_logger.log(request.remote_addr, 'FILES_DOWNLOAD_ZIP', {'files': selected_filenames})
        memory_file.seek(0)
        return send_file(memory_file, mimetype='application/zip', as_attachment=True, download_name='SnailSynk_Selected_Files.zip')
    except Exception as e:
        logging.error(f"Error creating ZIP for download: {e}")
        flash("An error occurred while creating the download.", "error")
        return redirect(url_for('.index'))

@main_bp.route('/api/files/lock_batch', methods=['POST'])
def lock_batch_files():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    
    data = request.get_json()
    filenames = data.get('filenames', [])
    password = data.get('password')
    subpath = data.get('subpath', '')

    if not isinstance(filenames, list) or not password:
        return jsonify(success=False, error="Invalid request data."), 400

    locked_files, failed_files = [], []
    for filename in filenames:
        # Determine if file or folder
        try:
            target_dir = file_manager._validate_subpath(subpath)
        except ValueError:
            failed_files.append(filename)
            continue
        full_path = os.path.join(target_dir, filename)
        if os.path.isdir(full_path):
            folder_subpath = f"{subpath}/{filename}" if subpath else filename
            success, _ = file_manager.lock_folder(folder_subpath, password)
        else:
            rel_path = f"{subpath}/{filename}" if subpath else filename
            success, _ = file_manager.lock_file(rel_path, password)
        if success:
            locked_files.append(filename)
        else:
            failed_files.append(filename)
    
    if locked_files:
        action_logger.log(request.remote_addr, 'FILES_LOCK_BATCH', {'files': locked_files})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to get updated file list after batch lock: {e}")

    return jsonify(
        success=True, 
        message="Batch lock operation complete.",
        details={'locked': locked_files, 'failed': failed_files}
    )

@main_bp.route('/api/files/delete_batch', methods=['DELETE'])
def delete_batch_files():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403

    data = request.get_json()
    filenames = data.get('filenames', [])
    subpath = data.get('subpath', '')

    if not isinstance(filenames, list):
        return jsonify(success=False, error="Invalid request data."), 400

    deleted_files, failed_files = [], []
    for filename in filenames:
        try:
            target_dir = file_manager._validate_subpath(subpath)
        except ValueError:
            failed_files.append(filename)
            continue
        full_path = os.path.join(target_dir, filename)
        if os.path.isdir(full_path):
            success, _ = file_manager.delete_folder(subpath, filename, request.remote_addr)
        else:
            rel_path = f"{subpath}/{filename}" if subpath else filename
            success, _ = file_manager.delete_file(rel_path, request.remote_addr)
        if success:
            deleted_files.append(filename)
        else:
            failed_files.append(filename)

    if deleted_files:
        action_logger.log(request.remote_addr, 'FILES_DELETE_BATCH', {'files': deleted_files})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to get updated file list after batch delete: {e}")

    return jsonify(
        success=True, 
        message="Batch delete operation complete.",
        details={'deleted': deleted_files, 'failed': failed_files}
    )

@main_bp.route('/api/files/unlock_batch', methods=['POST'])
def unlock_batch_files():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    
    data = request.get_json()
    filenames = data.get('filenames', [])
    password = data.get('password')
    subpath = data.get('subpath', '')

    if not isinstance(filenames, list) or password is None:
        return jsonify(success=False, error="Invalid request data."), 400

    unlocked_files, failed_files = [], []
    for filename in filenames:
        try:
            target_dir = file_manager._validate_subpath(subpath)
        except ValueError:
            failed_files.append(filename)
            continue
        full_path = os.path.join(target_dir, filename)
        if os.path.isdir(full_path):
            folder_subpath = f"{subpath}/{filename}" if subpath else filename
            success, _ = file_manager.unlock_folder(folder_subpath, password)
        else:
            rel_path = f"{subpath}/{filename}" if subpath else filename
            if file_manager.verify_file_password(rel_path, password):
                success, _ = file_manager.unlock_file(rel_path)
            else:
                success = False
        if success:
            unlocked_files.append(filename)
        else:
            failed_files.append(filename)
    
    if unlocked_files:
        action_logger.log(request.remote_addr, 'FILES_UNLOCK_BATCH', {'files': unlocked_files})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to get updated file list after batch unlock: {e}")

    return jsonify(
        success=True, 
        message="Batch unlock operation complete.",
        details={'unlocked': unlocked_files, 'failed': failed_files}
    )

@main_bp.route('/api/files/move_batch', methods=['POST'])
def move_batch_files():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403

    data = request.get_json()
    filenames = data.get('filenames', [])
    source_path = data.get('source_path', '')
    dest_path = data.get('dest_path', '')

    if not isinstance(filenames, list) or dest_path is None:
        return jsonify(success=False, error="Invalid request data."), 400

    moved_files, failed_files = [], []
    for filename in filenames:
        try:
            source_dir = file_manager._validate_subpath(source_path)
            dest_dir = file_manager._validate_subpath(dest_path)
        except ValueError:
            failed_files.append({'file': filename, 'reason': 'Invalid path.'})
            continue
        source_item = os.path.join(source_dir, filename)
        if os.path.isdir(source_item):
            # Move folder
            dest_item = os.path.join(dest_dir, filename)
            if os.path.exists(dest_item):
                failed_files.append({'file': filename, 'reason': 'Folder already exists at destination.'})
                continue
            try:
                import shutil
                shutil.move(source_item, dest_item)
                moved_files.append(filename)
            except Exception as e:
                logging.error(f"Error moving folder {source_item}: {e}")
                failed_files.append({'file': filename, 'reason': str(e)})
        else:
            success, msg = file_manager.move_file(filename, source_path, dest_path, request.remote_addr)
            if success:
                moved_files.append(filename)
            else:
                failed_files.append({'file': filename, 'reason': msg})

    if moved_files:
        action_logger.log(request.remote_addr, 'FILES_MOVE_BATCH', {'files': moved_files, 'from': source_path, 'to': dest_path})
        try:
            src_files = file_manager.list_files(source_path)
            socketio.emit('file_list_updated', {'files': src_files, 'path': source_path})
            dest_files = file_manager.list_files(dest_path)
            socketio.emit('file_list_updated', {'files': dest_files, 'path': dest_path})
        except Exception as e:
            logging.error(f"Failed to broadcast after batch move: {e}")

    return jsonify(
        success=True,
        message="Batch move operation complete.",
        details={'moved': moved_files, 'failed': failed_files}
    )

# --- Folder Management API ---
@main_bp.route('/api/files/list', methods=['GET'])
def list_files_api():
    """AJAX endpoint to list files in a given subpath."""
    subpath = request.args.get('path', '')
    try:
        files = file_manager.list_files(subpath)
        is_folder_locked = file_manager.is_folder_locked(subpath)
        return jsonify(success=True, files=files, path=subpath, is_folder_locked=is_folder_locked)
    except Exception as e:
        logging.error(f"Error listing files for path '{subpath}': {e}")
        return jsonify(success=False, error="Failed to list files."), 500

@main_bp.route('/api/file/move', methods=['POST'])
def move_file():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'filename' not in data or 'dest_path' not in data:
        return jsonify(success=False, error="Missing required fields."), 400
    filename = data['filename']
    source_path = data.get('source_path', '')
    dest_path = data['dest_path']
    success, message = file_manager.move_file(filename, source_path, dest_path, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FILE_MOVE', {'file': filename, 'from': source_path, 'to': dest_path})
        # Broadcast updated file lists for both source and destination
        try:
            src_files = file_manager.list_files(source_path)
            socketio.emit('file_list_updated', {'files': src_files, 'path': source_path})
            dest_files = file_manager.list_files(dest_path)
            socketio.emit('file_list_updated', {'files': dest_files, 'path': dest_path})
        except Exception as e:
            logging.error(f"Failed to broadcast after file move: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folders/list', methods=['GET'])
def list_all_folders():
    """Return all folder paths for the folder picker."""
    try:
        folders = file_manager.list_all_folders()
        return jsonify(success=True, folders=folders)
    except Exception as e:
        logging.error(f"Error listing all folders: {e}")
        return jsonify(success=False, error="Failed to list folders."), 500

@main_bp.route('/api/folder/lock', methods=['POST'])
def lock_folder():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'path' not in data or 'password' not in data:
        return jsonify(success=False, error="Folder path and password are required."), 400
    subpath = data['path']
    password = data['password']
    success, message = file_manager.lock_folder(subpath, password)
    if success:
        action_logger.log(request.remote_addr, 'FOLDER_LOCK', {'path': subpath})
        try:
            # Broadcast updated list for the parent folder
            parent = '/'.join(subpath.replace('\\', '/').split('/')[:-1])
            updated_files = file_manager.list_files(parent)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': parent})
        except Exception as e:
            logging.error(f"Failed to broadcast after folder lock: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folder/unlock', methods=['POST'])
def unlock_folder():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'path' not in data or 'password' not in data:
        return jsonify(success=False, error="Folder path and password are required."), 400
    subpath = data['path']
    password = data['password']
    success, message = file_manager.unlock_folder(subpath, password)
    if success:
        action_logger.log(request.remote_addr, 'FOLDER_UNLOCK', {'path': subpath})
        try:
            parent = '/'.join(subpath.replace('\\', '/').split('/')[:-1])
            updated_files = file_manager.list_files(parent)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': parent})
        except Exception as e:
            logging.error(f"Failed to broadcast after folder unlock: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folder/create', methods=['POST'])
def create_folder():
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify(success=False, error="Folder name is required."), 400
    subpath = data.get('path', '')
    folder_name = data.get('name', '').strip()
    if not folder_name:
        return jsonify(success=False, error="Folder name cannot be empty."), 400
    success, message = file_manager.create_folder(subpath, folder_name, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FOLDER_CREATE', {'name': folder_name, 'path': subpath})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to broadcast after folder creation: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folder/delete', methods=['DELETE'])
def delete_folder():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify(success=False, error="Folder name is required."), 400
    subpath = data.get('path', '')
    folder_name = data.get('name', '').strip()
    success, message = file_manager.delete_folder(subpath, folder_name, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FOLDER_DELETE', {'name': folder_name, 'path': subpath})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to broadcast after folder deletion: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/file/rename', methods=['POST'])
def rename_file():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'old_name' not in data or 'new_name' not in data:
        return jsonify(success=False, error="Missing required fields."), 400
    subpath = data.get('path', '')
    old_name = data['old_name']
    new_name = data['new_name'].strip()
    if not new_name:
        return jsonify(success=False, error="New name cannot be empty."), 400
    success, message = file_manager.rename_file(subpath, old_name, new_name, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FILE_RENAME', {'old': old_name, 'new': new_name, 'path': subpath})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to broadcast after file rename: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folder/rename', methods=['POST'])
def rename_folder():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'old_name' not in data or 'new_name' not in data:
        return jsonify(success=False, error="Missing required fields."), 400
    subpath = data.get('path', '')
    old_name = data['old_name']
    new_name = data['new_name'].strip()
    if not new_name:
        return jsonify(success=False, error="New name cannot be empty."), 400
    success, message = file_manager.rename_folder(subpath, old_name, new_name, request.remote_addr)
    if success:
        action_logger.log(request.remote_addr, 'FOLDER_RENAME', {'old': old_name, 'new': new_name, 'path': subpath})
        try:
            updated_files = file_manager.list_files(subpath)
            socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
        except Exception as e:
            logging.error(f"Failed to broadcast after folder rename: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/folder/download', methods=['POST'])
def download_folder_zip():
    data = request.get_json()
    if not data or 'folder_name' not in data:
        return jsonify(success=False, error="Missing folder name."), 400
    subpath = data.get('path', '')
    folder_name = data['folder_name']
    memory_file, error = file_manager.zip_folder(subpath, folder_name, request.remote_addr)
    if error:
        return jsonify(success=False, error=error), 400
    action_logger.log(request.remote_addr, 'FOLDER_DOWNLOAD', {'folder': folder_name, 'path': subpath})
    zip_name = f"{folder_name}.zip"
    return send_file(memory_file, mimetype='application/zip', as_attachment=True, download_name=zip_name)

@main_bp.route('/api/file/share', methods=['POST'])
def create_share_link():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'filepath' not in data:
        return jsonify(success=False, error="Missing filepath."), 400
    filepath = data['filepath']
    expiry_hours = data.get('expiry_hours', None)
    if expiry_hours is not None:
        try:
            expiry_hours = float(expiry_hours)
        except (ValueError, TypeError):
            return jsonify(success=False, error="Invalid expiry value."), 400
    token, error = file_manager.create_share_link(filepath, expiry_hours)
    if error:
        return jsonify(success=False, error=error), 400
    action_logger.log(request.remote_addr, 'FILE_SHARE_LINK', {'file': filepath, 'expiry_hours': expiry_hours})
    
    # Construct full URL with IP address
    from .utils import get_local_ip
    local_ip = get_local_ip()
    port = os.environ.get('SNAILSYNK_PORT', 9000)
    share_url = f"https://{local_ip}:{port}/share/{token}"
    
    return jsonify(success=True, token=token, url=share_url)

@main_bp.route('/share/<token>', methods=['GET'])
def resolve_share_link(token):
    filepath = file_manager.resolve_share_link(token)
    if not filepath:
        flash("This share link is invalid or has expired.", "error")
        return redirect(url_for('.index'))
    # Check if this is a folder share link
    link_data = file_manager.share_links.get(token, {})
    link_type = link_data.get('type', 'file')
    if link_type == 'folder':
        try:
            # Determine parent path and folder name
            parts = filepath.replace('\\', '/').rstrip('/').rsplit('/', 1)
            if len(parts) == 2:
                subpath, folder_name = parts
            else:
                subpath, folder_name = '', parts[0]
            memory_file, zip_error = file_manager.zip_folder(subpath, folder_name, request.remote_addr)
            if zip_error:
                flash(f"Error: {zip_error}", "error")
                return redirect(url_for('.index'))
            memory_file.seek(0)
            return send_file(memory_file, mimetype='application/zip', as_attachment=True, download_name=f'{folder_name}.zip')
        except Exception as e:
            logging.error(f"Error serving shared folder: {e}")
            flash("An error occurred while preparing the shared folder.", "error")
            return redirect(url_for('.index'))
    return send_from_directory(file_manager.files_folder, filepath, as_attachment=True)

@main_bp.route('/api/file/favorite', methods=['POST'])
def toggle_favorite():
    if not session.get('admin_logged_in'):
        return jsonify(success=False, error="Authentication required."), 403
    data = request.get_json()
    if not data or 'filepath' not in data:
        return jsonify(success=False, error="Missing filepath."), 400
    filepath = data['filepath']
    subpath = data.get('path', '')
    new_state = file_manager.toggle_favorite(filepath)
    action_logger.log(request.remote_addr, 'FILE_FAVORITE', {'file': filepath, 'favorited': new_state})
    try:
        updated_files = file_manager.list_files(subpath)
        socketio.emit('file_list_updated', {'files': updated_files, 'path': subpath})
    except Exception as e:
        logging.error(f"Failed to broadcast after favorite toggle: {e}")
    return jsonify(success=True, favorited=new_state)

# --- API and WebSocket Routes ---
@main_bp.route('/api/qr_code', methods=['POST'])
def generate_qr_code():
    data = request.get_json()
    if not data or 'type' not in data:
        return jsonify(success=False, error="Invalid request."), 400
    qr_type = data.get('type')
    logo_path = "static/icon/favicon.png"
    qr_data_string = ""
    qr_color = data.get('color', '#dc2626')
    
    if qr_type == 'ip':
        # Get dynamic port from the request
        host_port = request.host.split(':')
        port = host_port[1] if len(host_port) > 1 else '9000'
        qr_data_string = f"https://{get_local_ip()}:{port}"
    elif qr_type == 'wifi':
        if not data.get('ssid'): return jsonify(success=False, error="SSID is required."), 400
        qr_data_string = f"WIFI:T:WPA;S:{data.get('ssid')};P:{data.get('password')};;"
    elif qr_type == 'upi': qr_data_string = "upi://pay?pa=kumarsaksham@yesg&pn=Saksham&cu=INR"
    elif qr_type == 'instagram': qr_data_string = "https://www.instagram.com/Sometimes.Saksham/"
    else: return jsonify(success=False, error="Invalid QR code type."), 400
    try:
        svg_code = generate_custom_qr_svg(qr_data_string, color=qr_color, logo_path=logo_path if os.path.exists(logo_path) else None)
        return jsonify(success=True, svg=svg_code)
    except Exception as e:
        logging.error(f"Failed to generate QR code for type '{qr_type}': {e}")
        return jsonify(success=False, error="Server failed to generate QR code."), 500

@main_bp.route('/api/preview/<path:filename>')
def get_image_preview(filename):
    decoded_filename = unquote(filename)
    
    if file_manager.is_locked(decoded_filename):
        return jsonify(success=False, error="File is locked. Preview is unavailable."), 403
    
    b64_data = file_manager.get_image_preview_b64(decoded_filename)
    if b64_data: 
        return jsonify(success=True, data=b64_data)
    
    return jsonify(success=False, error="File is not a supported image or could not be found."), 404

@main_bp.route('/api/shared-text', methods=['GET', 'POST'])
def shared_text_api():
    if request.method == 'GET':
        return jsonify(success=True, text=content_manager.get_shared_text())
    # POST
    data = request.get_json()
    if not data or 'text' not in data: return jsonify(success=False, error="Invalid request."), 400
    updated_text = content_manager.update_shared_text(data['text'], request.remote_addr)
    socketio.emit('text_updated', {'text': updated_text})
    action_logger.log(request.remote_addr, 'BUFFER_UPDATE', {'length': len(updated_text)})
    return jsonify(success=True, message="Shared text updated.")

@main_bp.route('/api/copy-text', methods=['POST'])
def copy_text_to_clipboard():
    success, message = content_manager.copy_buffer_to_clipboard()
    return jsonify(success=success, error=None if success else message), 200 if success else 500

@main_bp.route('/api/pins', methods=['POST'])
def add_pin():
    text_to_pin = request.json.get('text', '')
    updated_pins, error = content_manager.add_pin(text_to_pin, request.remote_addr)
    if error: return jsonify(success=False, error=error), 400
    socketio.emit('pins_updated', {'pins': updated_pins})
    return jsonify(success=True, pins=updated_pins)

@main_bp.route('/api/pins/<pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    updated_pins, error = content_manager.delete_pin(pin_id, request.remote_addr)
    if error: return jsonify(success=False, error=error), 404
    socketio.emit('pins_updated', {'pins': updated_pins})
    return jsonify(success=True, pins=updated_pins)

@main_bp.route('/api/pins/clear', methods=['DELETE'])
def clear_all_pins():
    updated_pins, error = content_manager.clear_all_pins(request.remote_addr)
    socketio.emit('pins_updated', {'pins': updated_pins})
    return jsonify(success=True, pins=updated_pins)

@main_bp.route('/api/file/status/<path:filename>')
def get_file_status(filename):
    return jsonify(locked=file_manager.is_locked(unquote(filename)))

@main_bp.route('/api/file/lock/<path:filename>', methods=['POST'])
def lock_file(filename):
    if not session.get('admin_logged_in'): return jsonify(success=False, error="Authentication required."), 403
    password = request.json.get('password')
    if not password: return jsonify(success=False, error="Password is required."), 400
    success, message = file_manager.lock_file(unquote(filename), password)
    if success:
        action_logger.log(request.remote_addr, 'FILE_LOCK', {'file': unquote(filename)})
        # After lock, broadcast the updated file list
        try:
            updated_files = file_manager.list_files()
            socketio.emit('file_list_updated', {'files': updated_files})
        except Exception as e:
            logging.error(f"Failed to get updated file list after lock: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 400

@main_bp.route('/api/file/unlock/<path:filename>', methods=['POST'])
def unlock_file(filename):
    if not session.get('admin_logged_in'): return jsonify(success=False, error="Authentication required."), 403
    success, message = file_manager.unlock_file(unquote(filename))
    if success:
        action_logger.log(request.remote_addr, 'FILE_UNLOCK', {'file': unquote(filename)})
        # After unlock, broadcast the updated file list
        try:
            updated_files = file_manager.list_files()
            socketio.emit('file_list_updated', {'files': updated_files})
        except Exception as e:
            logging.error(f"Failed to get updated file list after unlock: {e}")
        return jsonify(success=True, message=message)
    return jsonify(success=False, error=message), 404

@main_bp.route('/api/file/download_locked/<path:filename>', methods=['POST'])
def download_locked_file(filename):
    password = request.json.get('password')
    if not password: return jsonify(error="Password is required."), 400
    decoded_filename = unquote(filename)
    if not file_manager.is_locked(decoded_filename): return jsonify(error="File is no longer locked."), 409
    if file_manager.verify_file_password(decoded_filename, password):
        action_logger.log(request.remote_addr, 'FILE_DOWNLOAD_UNLOCKED', {'file': decoded_filename})
        return send_from_directory(file_manager.files_folder, decoded_filename, as_attachment=True)
    else:
        action_logger.log(request.remote_addr, 'FILE_DOWNLOAD_FAIL', {'file': decoded_filename})
        return jsonify(error="Incorrect password."), 403

def register_socketio_events(sio):
    @sio.on('connect')
    def handle_connect():
        remote_ip = request.remote_addr
        sio.active_clients[request.sid] = {
            'ip': remote_ip, 'connected_since': datetime.now(timezone.utc).isoformat()
        }
        emit('pins_updated', {'pins': content_manager.get_pins()})
        sio.emit('update_client_list', list(sio.active_clients.values()), room='admin_room')

    @sio.on('disconnect')
    def handle_disconnect():
        if request.sid in sio.active_clients:
            del sio.active_clients[request.sid]
            sio.emit('update_client_list', list(sio.active_clients.values()), room='admin_room')

    @sio.on('join_admin')
    def handle_join_admin_room():
        if session.get('admin_logged_in'):
            join_room('admin_room')
            emit('update_client_list', list(sio.active_clients.values()))