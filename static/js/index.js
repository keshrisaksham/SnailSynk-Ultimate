// static/js/index.js
// --- UTILITY: Robust clipboard copy with fallbacks (works on Linux/HTTP) ---
async function copyToClipboard(text) {
    // Try modern clipboard API first (requires HTTPS or localhost)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn('Clipboard API failed:', err);
        }
    }

    // Fallback: execCommand with temporary textarea (works on HTTP)
    try {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = text;
        tempTextArea.style.position = 'fixed';
        tempTextArea.style.left = '-9999px';
        tempTextArea.style.top = '0';
        tempTextArea.setAttribute('readonly', '');
        document.body.appendChild(tempTextArea);
        tempTextArea.focus();
        tempTextArea.setSelectionRange(0, text.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(tempTextArea);
        if (copied) return true;
    } catch (err) {
        console.warn('execCommand copy failed:', err);
    }

    return false;
}

// --- UTILITY: Create a flash message ---
function flash(message, category = 'info') {
    const flashMessagesContainer = document.querySelector('.flash-messages') || document.createElement('ul');
    if (!document.querySelector('.flash-messages')) {
        flashMessagesContainer.className = 'flash-messages';
        document.body.appendChild(flashMessagesContainer);
    }
    const li = document.createElement('li');
    li.className = category;
    li.innerHTML = `<span>${message}</span><button class="close-flash">×</button>`;
    flashMessagesContainer.prepend(li);
    const closeBtn = li.querySelector('.close-flash');
    const dismiss = () => { li.style.opacity = '0'; setTimeout(() => li.remove(), 300); };
    closeBtn.addEventListener('click', dismiss);
    setTimeout(dismiss, 5000);
}


document.addEventListener('DOMContentLoaded', () => {
    // Guard Clause: Only run this script on the main page
    if (!document.getElementById('sharedTextArea')) {
        return;
    }

    const PIN_LIMIT = 10;
    const socket = io();

    // --- DOM ELEMENT SELECTION ---
    const sharedTextArea = document.getElementById('sharedTextArea');
    const commitBtn = document.getElementById('commitBtn');
    const selectBtn = document.getElementById('selectBtn');
    const clearBtn = document.getElementById('clearBtn');
    const pasteBtn = document.getElementById('pasteBtn');
    const pinBtn = document.getElementById('pinBtn');
    const clipboardStatus = document.getElementById('clipboardStatus');
    const textMeta = document.getElementById('textMeta');
    const selectTextAction = document.getElementById('selectTextAction');
    const viewBtnShared = document.getElementById('viewBtnShared');
    const viewBtnPinned = document.getElementById('viewBtnPinned');
    const sharedTextView = document.getElementById('shared-text-view');
    const pinnedMessagesView = document.getElementById('pinned-messages-view');
    const pinnedMessagesContainer = document.getElementById('pinned-messages-container');
    const bufferTitle = document.getElementById('buffer-title');
    const fileListBody = document.getElementById('file-list-body');
    const downloadSectionPanel = document.querySelector('.download-section .panel-body');

    // Folder navigation state
    let currentPath = '';

    // AI Chat Elements
    const viewBtnAiChat = document.getElementById('viewBtnAiChat');
    const aiChatView = document.getElementById('ai-chat-view');
    const aiChatMessages = document.getElementById('aiChatMessages');
    const aiChatInput = document.getElementById('aiChatInput');
    const aiChatSendBtn = document.getElementById('aiChatSendBtn');

    // View State
    let currentView = 'shared'; // 'shared' | 'pinned' | 'ai'
    let aiChatHistory = [];

    // AI Chat scrollbar auto-hide functionality
    let aiChatScrollTimeout = null;
    if (aiChatMessages) {
        aiChatMessages.addEventListener('scroll', () => {
            aiChatMessages.classList.add('scrolling');
            clearTimeout(aiChatScrollTimeout);
            aiChatScrollTimeout = setTimeout(() => {
                aiChatMessages.classList.remove('scrolling');
            }, 5000);
        });
    }

    // Markdown Editor Elements
    const editorBtn = document.getElementById('editorBtn');

    // Markdown Editor State
    let isEditorMode = false;
    let easyMDEInstance = null;

    // Markdown Preview Elements and State
    const previewBtn = document.getElementById('previewBtn');
    const markdownPreview = document.getElementById('markdownPreview');
    let isPreviewMode = false;

    // --- WEBSOCKET EVENT LISTENERS ---
    socket.on('text_updated', (data) => {
        if (sharedTextArea) {
            if (isEditorMode && easyMDEInstance) {
                // Update editor content if in editor mode
                easyMDEInstance.value(data.text);
            } else {
                // Update textarea if in plain text mode
                sharedTextArea.value = data.text;
            }
            updateTextMeta();
            setStatus('[OK] Buffer synced from another client.', 'info');
        }
    });
    socket.on('pins_updated', (data) => {
        renderPinnedMessages(data.pins);
        updatePinButtonState(data.pins.length);
    });
    socket.on('file_list_updated', (data) => {
        // Only re-render if the broadcast is for the path we're currently viewing
        const broadcastPath = data.path || '';
        if (broadcastPath !== currentPath) return;
        if (data.files && fileListBody) {
            flash('File list has been updated in real-time.', 'info');
            renderFileList(data.files);
            reinitializeFileActions();
        } else if (data.files && !fileListBody) {
            window.location.reload();
        }
    });

    // --- STATUS & UTILITY FUNCTIONS ---
    function setStatus(message, type = 'info', duration = 4000) {
        if (clipboardStatus) {
            clipboardStatus.textContent = message;
            clipboardStatus.className = 'clipboard-status';
            clipboardStatus.classList.add(`status-${type}`);
            setTimeout(() => {
                if (clipboardStatus.textContent === message) {
                    clipboardStatus.textContent = '';
                    clipboardStatus.className = 'clipboard-status';
                }
            }, duration);
        }
    }

    function selectText(element) {
        if (!element) return;
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // --- DYNAMIC FILE LIST RENDERING ---
    function renderFileList(items = []) {
        if (!fileListBody) return;

        const isAdmin = !!document.getElementById('lockSelectedBtn');
        fileListBody.innerHTML = '';

        if (items.length === 0 && currentPath === '') {
            fileListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem; color: var(--c-text-muted);">No files or folders. Upload a file or create a folder to get started!</td></tr>';
            return;
        }
        if (items.length === 0 && currentPath !== '') {
            fileListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem; color: var(--c-text-muted);">This folder is empty.</td></tr>';
            return;
        }

        let rowsHtml = '';
        items.forEach(item => {
            if (item.type === 'folder') {
                const folderLocked = item.is_locked;
                const folderLockBtn = isAdmin ? `
                    <button type="button" class="btn-icon folder-lock-btn" title="${folderLocked ? 'Unlock Folder' : 'Lock Folder'}" data-folder-path="${item.encoded_name}" data-locked="${folderLocked}">
                        ${folderLocked
                        ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
                        : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`
                    }
                    </button>` : '';
                const folderDeleteBtn = isAdmin ? `
                    <button type="button" class="btn-icon delete-folder-btn" title="Delete folder ${item.name}" data-folder-name="${item.name}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>` : '';
                const lockedBadge = folderLocked ? ' <span style="color:var(--c-text-muted); font-size:0.75rem;">🔒</span>' : '';
                rowsHtml += `
                    <tr data-file-row="${item.encoded_name}" data-sort-name="${item.name.toLowerCase()}" data-sort-date="${item.mtime}" data-type="folder" class="folder-row">
                        <td style="text-align: center;"><input type="checkbox" class="file-checkbox" disabled></td>
                        <td>
                            <a href="javascript:void(0)" class="folder-link" data-folder-name="${item.name}" data-folder-path="${item.encoded_name}" title="Open ${item.name}">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                ${item.name}${lockedBadge}
                            </a>
                        </td>
                        <td class="index-file-actions">${folderLockBtn}${folderDeleteBtn}</td>
                    </tr>`;
            } else {
                const lockedAttr = item.is_locked ? 'true' : 'false';
                const lockTitle = item.is_locked ? 'Unlock File' : 'Lock File';
                const lockIcon = item.is_locked
                    ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
                    : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
                const adminButtons = isAdmin ? `
                    <button type="button" class="btn-icon file-move-btn" title="Move ${item.name}" data-filename="${item.name}" data-encoded="${item.encoded_name}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M10 14L21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
                    </button>
                    <button type="button" class="btn-icon file-lock-btn" title="${lockTitle}" data-filename="${item.encoded_name}">${lockIcon}</button>
                    <button type="button" class="btn-icon delete-file-btn" title="Delete ${item.name}" data-filename="${item.encoded_name}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>` : '';
                rowsHtml += `
                    <tr data-file-row="${item.encoded_name}" data-sort-name="${item.name.toLowerCase()}" data-sort-date="${item.mtime}" data-type="file">
                        <td style="text-align: center;"><input type="checkbox" name="selected_files" value="${item.name}" class="file-checkbox"></td>
                        <td><a href="/files/${item.encoded_name}" download title="Download ${item.name}" class="file-link-preview" data-filename="${item.encoded_name}" data-locked="${lockedAttr}">${item.name}</a></td>
                        <td class="index-file-actions">
                            <a href="/files/${item.encoded_name}" class="btn-icon file-download-link" title="Download ${item.name}" data-filename="${item.encoded_name}" data-locked="${lockedAttr}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
                            ${adminButtons}
                        </td>
                    </tr>`;
            }
        });
        rowsHtml += '<tr id="noResultsRow" style="display: none;"><td colspan="3" style="text-align: center;">No matching files found.</td></tr>';
        fileListBody.innerHTML = rowsHtml;
    }

    function reinitializeFileActions() {
        updateDownloadSelectedButtonState();
        rebindImagePreviews();
        rebindSearchAndSort();
        bindFolderActions();
    }

    // --- FOLDER NAVIGATION ---
    function navigateToFolder(path) {
        currentPath = path;
        // Sync hidden subpath inputs
        const uploadSubpath = document.getElementById('uploadSubpath');
        const downloadSubpath = document.getElementById('downloadSubpath');
        if (uploadSubpath) uploadSubpath.value = path;
        if (downloadSubpath) downloadSubpath.value = path;

        // Update upload description to show current upload target
        const uploadDesc = document.querySelector('.upload-section .section-description');
        if (uploadDesc) {
            uploadDesc.textContent = path
                ? `Uploading to folder: ${path}`
                : 'Select or drag files to upload to the shared directory.';
        }

        renderBreadcrumbs(path);

        fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    renderFileList(data.files);
                    reinitializeFileActions();
                    // Update upload section visibility based on folder lock state
                    const uploadSection = document.querySelector('.upload-section');
                    const isAdminUser = !!document.getElementById('lockSelectedBtn');
                    if (uploadSection) {
                        if (!isAdminUser && data.is_folder_locked) {
                            uploadSection.style.display = 'none';
                        } else {
                            uploadSection.style.display = '';
                        }
                    }
                } else {
                    flash(`[ERR] ${data.error || 'Failed to load folder.'}`, 'error');
                }
            })
            .catch(err => {
                console.error('Error navigating to folder:', err);
                flash('[ERR] Failed to load folder.', 'error');
            });
    }

    function renderBreadcrumbs(path) {
        const breadcrumbNav = document.getElementById('breadcrumbNav');
        if (!breadcrumbNav) return;

        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;

        let html = `<span class="breadcrumb-item breadcrumb-root ${path === '' ? 'breadcrumb-active' : ''}" data-path="">${homeIcon} Root</span>`;

        if (path) {
            const parts = path.split('/');
            let accumulated = '';
            parts.forEach((part, i) => {
                accumulated += (i > 0 ? '/' : '') + part;
                const isLast = i === parts.length - 1;
                html += `<span class="breadcrumb-separator">/</span>`;
                html += `<span class="breadcrumb-item ${isLast ? 'breadcrumb-active' : ''}" data-path="${accumulated}">${decodeURIComponent(part)}</span>`;
            });
        }
        breadcrumbNav.innerHTML = html;

        // Bind click on breadcrumb items
        breadcrumbNav.querySelectorAll('.breadcrumb-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetPath = item.dataset.path;
                navigateToFolder(targetPath);
            });
        });
    }

    function bindFolderActions() {
        // Folder link clicks (navigate into)
        document.querySelectorAll('.folder-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const folderPath = decodeURIComponent(link.dataset.folderPath);
                navigateToFolder(folderPath);
            });
        });

        // Folder delete buttons
        document.querySelectorAll('.delete-folder-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const folderName = btn.dataset.folderName;
                const confirmed = await snailConfirm('Delete Folder', `Are you sure you want to permanently delete the folder "${folderName}" and ALL its contents?`, { danger: true, confirmText: 'Delete' });
                if (!confirmed) return;
                setStatus(`[INFO] Deleting folder '${folderName}'...`, 'info', 60000);
                try {
                    const response = await fetch('/api/folder/delete', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: currentPath, name: folderName })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Failed to delete folder.');
                    setStatus(`[OK] Folder '${folderName}' deleted.`, 'success');
                } catch (error) {
                    console.error('Error deleting folder:', error);
                    setStatus(`[ERR] ${error.message}`, 'error');
                }
            });
        });

        // Folder lock/unlock buttons (admin only)
        document.querySelectorAll('.folder-lock-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const folderPath = decodeURIComponent(btn.dataset.folderPath);
                const isLocked = btn.dataset.locked === 'true';
                const endpoint = isLocked ? '/api/folder/unlock' : '/api/folder/lock';
                const action = isLocked ? 'Unlock' : 'Lock';
                const password = await snailPrompt(`${action} Folder`, `Enter a password to ${action.toLowerCase()} this folder:`, { type: 'password', placeholder: 'Enter password...', confirmText: action });
                if (!password) return;
                setStatus(`[INFO] ${action}ing folder...`, 'info', 60000);
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: folderPath, password })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || `Failed to ${action.toLowerCase()} folder.`);
                    setStatus(`[OK] ${result.message}`, 'success');
                } catch (error) {
                    console.error(`Error ${action.toLowerCase()}ing folder:`, error);
                    setStatus(`[ERR] ${error.message}`, 'error');
                }
            });
        });

        // File move buttons (admin only)
        document.querySelectorAll('.file-move-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const filename = btn.dataset.filename;
                openMoveModal(filename, currentPath);
            });
        });
    }

    // New Folder button handler
    const newFolderBtn = document.getElementById('newFolderBtn');
    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', async () => {
            const folderName = await snailPrompt('New Folder', 'Enter a name for the new folder:', { placeholder: 'Folder name...', confirmText: 'Create' });
            if (!folderName) return;
            setStatus(`[INFO] Creating folder '${folderName}'...`, 'info', 60000);
            try {
                const response = await fetch('/api/folder/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: currentPath, name: folderName })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to create folder.');
                setStatus(`[OK] ${result.message}`, 'success');
            } catch (error) {
                console.error('Error creating folder:', error);
                setStatus(`[ERR] ${error.message}`, 'error');
            }
        });
    }

    // Initial binding for server-rendered folder actions
    bindFolderActions();

    function rebindImagePreviews() {
        const imagePreviewPopup = document.getElementById('imagePreviewPopup');
        if (!imagePreviewPopup) return;
        const supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
        let previewFetchTimeout;

        const positionPreviewPopup = (mouseEvent) => {
            const img = imagePreviewPopup.querySelector('img');
            if (!img || !img.complete) {
                requestAnimationFrame(() => positionPreviewPopup(mouseEvent));
                return;
            }
            const popupWidth = imagePreviewPopup.offsetWidth;
            const popupHeight = imagePreviewPopup.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const cursorPadding = 15;
            let top = mouseEvent.clientY + cursorPadding;
            let left = mouseEvent.clientX + cursorPadding;
            if (left + popupWidth > viewportWidth) { left = mouseEvent.clientX - popupWidth - cursorPadding; }
            if (top + popupHeight > viewportHeight) { top = mouseEvent.clientY - popupHeight - cursorPadding; }
            imagePreviewPopup.style.top = `${top}px`;
            imagePreviewPopup.style.left = `${left}px`;
        };

        // Get fresh file links (these are newly rendered so no old listeners exist)
        const fileLinks = document.querySelectorAll('.file-link-preview');

        fileLinks.forEach(link => {
            // Mark as having preview bound to avoid duplicate bindings
            if (link.dataset.previewBound === 'true') return;
            link.dataset.previewBound = 'true';

            link.addEventListener('mouseenter', (e) => {
                if (link.dataset.locked === 'true') return;
                const encodedFilename = link.dataset.filename;
                const filename = decodeURIComponent(encodedFilename);
                const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
                if (!supportedImageExtensions.includes(extension)) { return; }
                clearTimeout(previewFetchTimeout);
                previewFetchTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`/api/preview/${encodedFilename}`);
                        if (!response.ok) return;
                        const result = await response.json();
                        if (result.success && result.data) {
                            imagePreviewPopup.innerHTML = `<img src="${result.data}" alt="Preview">`;
                            positionPreviewPopup(e);
                            imagePreviewPopup.classList.add('visible');
                        }
                    } catch (error) { console.error('Error fetching image preview:', error); }
                }, 100);
            });
            link.addEventListener('mouseleave', () => {
                clearTimeout(previewFetchTimeout);
                imagePreviewPopup.classList.remove('visible');
                setTimeout(() => { if (!imagePreviewPopup.classList.contains('visible')) { imagePreviewPopup.innerHTML = ''; } }, 200);
            });
            link.addEventListener('mousemove', (e) => {
                if (imagePreviewPopup.classList.contains('visible')) { positionPreviewPopup(e); }
            });
        });
    }

    function rebindSearchAndSort() {
        // Re-run the sort function to order the new list using the custom dropdown
        if (typeof sortTableRowsCustom === 'function') {
            sortTableRowsCustom();
        }

        // Re-apply the current search query
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value) {
            searchInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
    }

    // --- FILE UPLOAD LOGIC ---
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadButton = document.getElementById('uploadButton');
    const chooseButton = document.getElementById('chooseButton');
    const clearUploadBtn = document.getElementById('clearUploadBtn');
    const fileDropZone = document.getElementById('fileDropZone');
    const fullPageDropZone = document.getElementById('fullPageDropZone');
    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressBar = document.getElementById('uploadProgressBar');
    let currentUploadXhr = null; // Track current upload for cancellation

    function fileUploaded() {
        if (!fileInput || !uploadButton || !chooseButton || !fileDropZone) return;
        if (fileInput.files.length > 0) {
            fileDropZone.classList.add('file-selected');
            let displayNames = Array.from(fileInput.files).map(file => {
                const filename = file.name;
                return filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
            });
            fileDropZone.innerHTML = `<p><strong>Selected:</strong> ${displayNames.join(', ')}</p>`;
            chooseButton.textContent = 'Choose Another';
            uploadButton.textContent = `Upload ${fileInput.files.length > 1 ? fileInput.files.length + ' Files' : 'Now'}`;
            uploadButton.disabled = false;
            if (clearUploadBtn) {
                clearUploadBtn.style.display = 'inline-flex';
                clearUploadBtn.textContent = 'Clear';
            }
        } else {
            fileDropZone.classList.remove('file-selected');
            fileDropZone.innerHTML = '<p><strong>Drag & drop files here</strong> or click to select</p>';
            chooseButton.textContent = 'Choose File';
            uploadButton.textContent = 'Upload';
            uploadButton.disabled = true;
            if (clearUploadBtn) {
                clearUploadBtn.style.display = 'none';
            }
        }
    }

    function clearFileSelection() {
        if (fileInput) {
            fileInput.value = '';
            fileUploaded();
        }
    }

    if (fileDropZone) {
        fileDropZone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZone.classList.add('drag-over'); });
        fileDropZone.addEventListener('dragleave', () => { fileDropZone.classList.remove('drag-over'); });
        fileDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            fileDropZone.classList.remove('drag-over');
            document.getElementById('fileInput').files = e.dataTransfer.files;
            fileUploaded();
        });
        fileDropZone.addEventListener('click', () => { document.getElementById('fileInput').click(); });
    }

    if (fullPageDropZone && fileInput) {
        let dragCounter = 0;
        window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; fullPageDropZone.classList.add('active'); });
        window.addEventListener('dragover', (e) => { e.preventDefault(); });
        window.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) { fullPageDropZone.classList.remove('active'); } });
        window.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            fullPageDropZone.classList.remove('active');
            if (e.target.id !== 'fileDropZone' && !fileDropZone.contains(e.target)) {
                fileInput.files = e.dataTransfer.files;
                fileUploaded();
            }
        });
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!fileInput.files.length) return;
            const formData = new FormData();
            for (const file of fileInput.files) {
                formData.append('file', file);
            }
            // Include current folder subpath so files upload to the active folder
            const subpathInput = document.getElementById('uploadSubpath');
            if (subpathInput && subpathInput.value) {
                formData.append('subpath', subpathInput.value);
            }
            uploadButton.disabled = true;
            uploadButton.textContent = 'Uploading...';
            if (progressContainer) progressContainer.style.display = 'block';
            if (progressBar) progressBar.style.width = '0%';

            // Change clear button to cancel
            if (clearUploadBtn) {
                clearUploadBtn.textContent = 'Cancel';
                clearUploadBtn.style.display = 'inline-flex';
            }

            const xhr = new XMLHttpRequest();
            currentUploadXhr = xhr;
            xhr.open('POST', uploadForm.action, true);
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    if (progressBar) progressBar.style.width = percentComplete + '%';
                }
            });
            xhr.onload = () => {
                currentUploadXhr = null;
                if (progressContainer) progressContainer.style.display = 'none';
                if (xhr.status >= 200 && xhr.status < 400) {
                    // SUCCESS! The WebSocket 'file_list_updated' event will handle re-rendering the list
                    flash('Upload successful!', 'success');
                    clearFileSelection(); // Reset the upload form
                } else {
                    uploadButton.disabled = false;
                    fileUploaded(); // Reset the button state
                    flash(`[ERR] Upload failed. Server responded with status ${xhr.status}.`, 'error');
                    console.error('Upload failed:', xhr.responseText);
                }
            };
            xhr.onerror = () => {
                currentUploadXhr = null;
                flash('[ERR] A network error occurred during the upload.', 'error');
                if (progressContainer) progressContainer.style.display = 'none';
                uploadButton.disabled = false;
                fileUploaded();
            };
            xhr.onabort = () => {
                currentUploadXhr = null;
                flash('[INFO] Upload cancelled.', 'info');
                if (progressContainer) progressContainer.style.display = 'none';
                uploadButton.disabled = false;
                clearFileSelection();
            };
            xhr.send(formData);
        });
    }

    // Clear/Cancel upload button handler
    if (clearUploadBtn) {
        clearUploadBtn.addEventListener('click', () => {
            if (currentUploadXhr) {
                // Cancel ongoing upload
                currentUploadXhr.abort();
            } else {
                // Clear file selection
                clearFileSelection();
            }
        });
    }

    // --- CONTENT MANAGEMENT (SHARED TEXT) LOGIC ---
    const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname.toLowerCase());
    if (selectTextAction) { selectTextAction.textContent = isLocal ? 'copies to clipboard' : 'copies to clipboard'; }
    function updateTextMeta() { if (sharedTextArea && textMeta) { const charCount = sharedTextArea.value.length; textMeta.textContent = `${charCount} chars`; updatePinButtonState(); } }
    async function loadSharedText() { if (!sharedTextArea) return; try { const response = await fetch('/api/shared-text'); if (!response.ok) throw new Error(`Server error: ${response.status}`); const result = await response.json(); if (result.success) { sharedTextArea.value = result.text; updateTextMeta(); } else { throw new Error(result.error || 'Unknown server error'); } } catch (error) { console.error('Error loading shared text:', error); setStatus(`[ERR] Load failed: ${error.message}`, 'error'); sharedTextArea.value = 'Error loading content.'; sharedTextArea.disabled = true; if (commitBtn) commitBtn.disabled = true; } }
    async function commitSharedText() { if (!sharedTextArea || !commitBtn) return; const textToSend = isEditorMode && easyMDEInstance ? easyMDEInstance.value() : sharedTextArea.value; commitBtn.disabled = true; commitBtn.textContent = 'Committing...'; setStatus('', 'info'); try { const response = await fetch('/api/shared-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textToSend }), }); if (!response.ok) throw new Error(`Server error: ${response.status}`); const result = await response.json(); if (result.success) { setStatus('[OK] Buffer updated.', 'success'); } else { throw new Error(result.error || 'Unknown server error'); } } catch (error) { console.error('Error committing shared text:', error); setStatus(`[ERR] Commit failed: ${error.message}`, 'error'); } finally { commitBtn.disabled = false; commitBtn.textContent = 'Commit'; } }
    function clearSharedText() {
        if (sharedTextArea) {
            if (isEditorMode && easyMDEInstance) { easyMDEInstance.value(''); } else { sharedTextArea.value = ''; }
            // Exit preview mode if active
            if (isPreviewMode) {
                isPreviewMode = false;
                markdownPreview.classList.add('view-hidden');
                markdownPreview.innerHTML = '';
                sharedTextArea.classList.remove('preview-active');
                previewBtn.classList.remove('active');
            }
            updateTextMeta(); commitSharedText(); setStatus('[OK] Buffer cleared.', 'success');
        }
    }
    async function selectSharedText() {
        if (!sharedTextArea || !selectBtn) return;
        setStatus('', 'info');
        const textToCopy = sharedTextArea.value;
        if (!textToCopy) {
            setStatus('[INFO] Buffer is empty, nothing to copy.', 'info');
            return;
        }
        selectBtn.disabled = true;
        selectBtn.textContent = 'Copying...';

        let copied = false;

        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(textToCopy);
                copied = true;
            } catch (err) {
                console.warn('Clipboard API failed:', err);
            }
        }

        // Fallback: Use execCommand with temporary textarea (mobile-friendly)
        if (!copied) {
            try {
                const tempTextArea = document.createElement('textarea');
                tempTextArea.value = textToCopy;
                tempTextArea.style.position = 'fixed';
                tempTextArea.style.left = '-9999px';
                tempTextArea.style.top = '0';
                tempTextArea.setAttribute('readonly', '');
                document.body.appendChild(tempTextArea);

                // Select for iOS
                tempTextArea.focus();
                tempTextArea.setSelectionRange(0, textToCopy.length);

                copied = document.execCommand('copy');
                document.body.removeChild(tempTextArea);
            } catch (err) {
                console.warn('execCommand copy failed:', err);
            }
        }

        if (copied) {
            setStatus('[OK] Text copied to clipboard.', 'success');
            flash('[OK] Text copied!', 'success');
        } else {
            // Ultimate fallback: select text in the textarea
            sharedTextArea.focus();
            sharedTextArea.setSelectionRange(0, sharedTextArea.value.length);
            setStatus('[INFO] Text selected. Long-press and tap Copy.', 'info');
        }

        selectBtn.disabled = false;
        selectBtn.textContent = 'Select';
    }

    // --- PINNED MESSAGES LOGIC ---
    function updatePinButtonState(pinCount) { if (!pinBtn) return; const currentPinCount = pinCount ?? (pinnedMessagesContainer.children.length - (pinnedMessagesContainer.querySelector('.no-pins-message') ? 1 : 0)); const isTextAreaEmpty = sharedTextArea.value.trim() === ''; if (currentPinCount >= PIN_LIMIT) { pinBtn.disabled = true; pinBtn.title = `Pin limit of ${PIN_LIMIT} reached.`; } else if (isTextAreaEmpty) { pinBtn.disabled = true; pinBtn.title = 'Cannot pin empty text.'; } else { pinBtn.disabled = false; pinBtn.title = 'Pin the current text'; } }
    async function handlePinClick() { const textToPin = sharedTextArea.value; if (textToPin.trim() === '' || pinBtn.disabled) return; pinBtn.disabled = true; try { const response = await fetch('/api/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textToPin }), }); const result = await response.json(); if (!result.success) { throw new Error(result.error || 'Failed to pin message.'); } flash('[OK] Message pinned successfully.', 'success'); setStatus('[OK] Message pinned.', 'success'); } catch (error) { console.error('Error pinning message:', error); setStatus(`[ERR] ${error.message}`, 'error'); } }
    async function handleUnpinClick(pinId) { try { const response = await fetch(`/api/pins/${pinId}`, { method: 'DELETE' }); const result = await response.json(); if (!result.success) { throw new Error(result.error || 'Failed to unpin message.'); } setStatus('[OK] Message unpinned.', 'success'); } catch (error) { console.error('Error unpinning message:', error); setStatus(`[ERR] ${error.message}`, 'error'); } }
    function renderPinnedMessages(pins = []) {
        if (!pinnedMessagesContainer) return;
        pinnedMessagesContainer.innerHTML = '';
        if (pins.length === 0) {
            pinnedMessagesContainer.innerHTML = '<p class="no-pins-message">No pinned messages. Type something in the shared buffer and click "Pin" to save it here.</p>';
            return;
        }
        pins.forEach(pin => {
            const card = document.createElement('div');
            card.className = 'pin-card';
            card.dataset.id = pin.id;

            const content = document.createElement('div');
            content.className = 'pin-card-content';
            content.textContent = pin.text;
            card.appendChild(content);

            const actions = document.createElement('div');
            actions.className = 'pin-card-actions';
            actions.innerHTML = `<button class="btn btn-secondary copy-pin-btn" title="Copy to Clipboard">Copy</button><button class="btn btn-secondary enlarge-pin-btn" title="Expand/Collapse">Enlarge</button><button class="btn btn-icon unpin-btn" title="Unpin Message"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>`;
            card.appendChild(actions);

            pinnedMessagesContainer.appendChild(card);
        });
    }
    function switchView(view) {
        currentView = view;
        // Hide all views
        sharedTextView.classList.add('view-hidden');
        pinnedMessagesView.classList.add('view-hidden');
        aiChatView.classList.add('view-hidden');
        // Deactivate all buttons
        if (viewBtnShared) viewBtnShared.classList.remove('active');
        if (viewBtnPinned) viewBtnPinned.classList.remove('active');
        if (viewBtnAiChat) viewBtnAiChat.classList.remove('active');
        // Show the selected view
        if (view === 'shared') {
            sharedTextView.classList.remove('view-hidden');
            if (viewBtnShared) viewBtnShared.classList.add('active');
            bufferTitle.textContent = 'Shared Text Buffer';
        } else if (view === 'pinned') {
            pinnedMessagesView.classList.remove('view-hidden');
            if (viewBtnPinned) viewBtnPinned.classList.add('active');
            bufferTitle.textContent = 'Pinned Buffer';
        } else if (view === 'ai') {
            aiChatView.classList.remove('view-hidden');
            if (viewBtnAiChat) viewBtnAiChat.classList.add('active');
            bufferTitle.textContent = 'AI Chat';
        }
    }
    // Backward-compat alias
    function toggleViews() { switchView(currentView); }

    if (pinnedMessagesContainer) {
        pinnedMessagesContainer.addEventListener('click', async (e) => {
            const copyBtn = e.target.closest('.copy-pin-btn');
            const enlargeBtn = e.target.closest('.enlarge-pin-btn');
            const unpinBtn = e.target.closest('.unpin-btn');
            if (copyBtn) { const card = copyBtn.closest('.pin-card'); const content = card.querySelector('.pin-card-content').textContent; const copied = await copyToClipboard(content); if (copied) { flash('[OK] Pinned text copied.', 'success'); } else { flash('[ERR] Failed to copy.', 'error'); } }
            if (enlargeBtn) {
                const card = enlargeBtn.closest('.pin-card');
                const content = card.querySelector('.pin-card-content');
                const isExpanded = content.classList.toggle('expanded');
                enlargeBtn.textContent = isExpanded ? 'Collapse' : 'Enlarge';
            }
            if (unpinBtn) { const card = unpinBtn.closest('.pin-card'); const pinId = card.dataset.id; if (pinId) { handleUnpinClick(pinId); } }
        });
    }

    // Clear All Pins button
    const clearAllPinsBtn = document.getElementById('clearAllPinsBtn');
    if (clearAllPinsBtn) {
        clearAllPinsBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/pins/clear', { method: 'DELETE' });
                const result = await response.json();
                if (!result.success) { throw new Error(result.error || 'Failed to clear pins.'); }
                flash('[OK] All pins cleared.', 'success');
            } catch (error) {
                console.error('Error clearing pins:', error);
                flash(`[ERR] ${error.message}`, 'error');
            }
        });
    }

    // --- FILE LIST MANAGEMENT (DELETE, LOCK, SEARCH, SELECT) ---
    const downloadTableBody = document.querySelector('#downloadSelectedForm tbody');
    if (downloadTableBody) {
        downloadTableBody.addEventListener('click', async (e) => {
            const deleteButton = e.target.closest('.delete-file-btn');
            if (!deleteButton) return;
            const encodedFilename = deleteButton.dataset.filename;
            const decodedFilename = decodeURIComponent(encodedFilename);
            if (!confirm(`Are you sure you want to permanently delete the file:\n\n${decodedFilename}`)) { return; }
            setStatus(`[INFO] Deleting '${decodedFilename}'...`, 'info', 60000);
            try {
                const response = await fetch(`/delete/${encodedFilename}`, { method: 'DELETE' });
                const result = await response.json();
                if (!response.ok) { throw new Error(result.error || `Server responded with status ${response.status}`); }
                // No longer need to manually remove row, the websocket update will handle it.
                setStatus(`[OK] File '${decodedFilename}' was deleted.`, 'success');
            } catch (error) {
                console.error('Error deleting file:', error);
                setStatus(`[ERR] Failed to delete file: ${error.message}`, 'error');
            }
        });
    }

    function updateDownloadSelectedButtonState() {
        const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
        const selectAllFilesCheckbox = document.getElementById('selectAllFilesCheckbox');
        const fileCheckboxes = document.querySelectorAll('.file-checkbox:not(:disabled)');

        if (!downloadSelectedBtn || !fileCheckboxes) return;
        const anySelected = Array.from(fileCheckboxes).some(cb => cb.checked);
        downloadSelectedBtn.disabled = !anySelected;

        const lockSelectedBtn = document.getElementById('lockSelectedBtn');
        const unlockSelectedBtn = document.getElementById('unlockSelectedBtn');
        const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
        if (lockSelectedBtn) lockSelectedBtn.disabled = !anySelected;
        if (unlockSelectedBtn) unlockSelectedBtn.disabled = !anySelected;
        if (deleteSelectedBtn) deleteSelectedBtn.disabled = !anySelected;

        if (selectAllFilesCheckbox) {
            const visibleCheckboxes = Array.from(fileCheckboxes).filter(cb => !cb.closest('tr').classList.contains('row-hidden'));
            if (visibleCheckboxes.length === 0) {
                selectAllFilesCheckbox.checked = false;
            } else {
                selectAllFilesCheckbox.checked = visibleCheckboxes.every(cb => cb.checked);
            }
        }
    }
    document.body.addEventListener('change', (e) => {
        if (e.target.matches('#selectAllFilesCheckbox')) {
            const fileCheckboxes = document.querySelectorAll('.file-checkbox:not(:disabled)');
            fileCheckboxes.forEach(cb => {
                if (!cb.closest('tr').classList.contains('row-hidden')) {
                    cb.checked = e.target.checked;
                }
            });
            updateDownloadSelectedButtonState();
        }
        if (e.target.matches('.file-checkbox')) {
            updateDownloadSelectedButtonState();
        }
    });

    // --- SEARCH AND SORT BINDINGS ---
    const sortToggleBtn = document.getElementById('sortToggleBtn');
    const sortOptionsPanel = document.getElementById('sortOptions');
    let currentSortValue = 'date-desc'; // Default sort value
    let currentGroupValue = 'folders-first'; // Default group value

    if (sortToggleBtn && sortOptionsPanel) {
        sortToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sortOptionsPanel.classList.toggle('visible');
        });

        sortOptionsPanel.addEventListener('click', (e) => {
            const option = e.target.closest('.custom-sort-option');
            if (!option) return;

            if (option.dataset.value) {
                // Sort option clicked — update only sort active states
                sortOptionsPanel.querySelectorAll('.custom-sort-option[data-value]').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                currentSortValue = option.dataset.value;
            } else if (option.dataset.group) {
                // Group option clicked — update only group active states
                sortOptionsPanel.querySelectorAll('.custom-sort-option[data-group]').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                currentGroupValue = option.dataset.group;
            }
            sortOptionsPanel.classList.remove('visible');
            // Trigger sort
            sortTableRowsCustom();
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#customSortDropdown')) {
                sortOptionsPanel.classList.remove('visible');
            }
        });
    }

    function sortTableRowsCustom() {
        if (!fileListBody) return;
        const rows = Array.from(fileListBody.querySelectorAll('tr[data-file-row]'));
        // 1. Sort by selected sort criteria
        rows.sort((a, b) => {
            const nameA = a.dataset.sortName;
            const nameB = b.dataset.sortName;
            const dateA = parseFloat(a.dataset.sortDate);
            const dateB = parseFloat(b.dataset.sortDate);
            switch (currentSortValue) {
                case 'name-asc': return nameA.localeCompare(nameB);
                case 'name-desc': return nameB.localeCompare(nameA);
                case 'date-asc': return dateA - dateB;
                case 'date-desc': default: return dateB - dateA;
            }
        });
        // 2. Apply grouping if active
        if (currentGroupValue === 'folders-first') {
            const folders = rows.filter(r => r.dataset.type === 'folder');
            const files = rows.filter(r => r.dataset.type !== 'folder');
            [...folders, ...files].forEach(row => fileListBody.appendChild(row));
        } else if (currentGroupValue === 'files-first') {
            const folders = rows.filter(r => r.dataset.type === 'folder');
            const files = rows.filter(r => r.dataset.type !== 'folder');
            [...files, ...folders].forEach(row => fileListBody.appendChild(row));
        } else {
            rows.forEach(row => fileListBody.appendChild(row));
        }
    }
    const searchToggleBtn = document.getElementById('searchToggleBtn');
    const searchContainer = document.getElementById('searchContainer');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (searchToggleBtn && searchContainer && searchInput) {
        searchToggleBtn.addEventListener('click', () => { searchContainer.classList.toggle('visible'); if (searchContainer.classList.contains('visible')) { searchInput.focus(); } else { searchInput.blur(); } });
        searchInput.addEventListener('input', () => {
            const fileTableRows = document.querySelectorAll('#downloadSelectedForm tbody tr:not(#noResultsRow)');
            const noResultsRow = document.getElementById('noResultsRow');
            const query = searchInput.value.toLowerCase().trim();
            let visibleCount = 0;
            clearSearchBtn.classList.toggle('visible', query.length > 0);
            fileTableRows.forEach(row => {
                const fileNameLink = row.querySelector('td:nth-child(2) a');
                if (fileNameLink) {
                    const fileName = fileNameLink.textContent.toLowerCase();
                    const isVisible = fileName.includes(query);
                    row.classList.toggle('row-hidden', !isVisible);
                    if (isVisible) visibleCount++;
                }
            });
            if (noResultsRow) { noResultsRow.style.display = visibleCount === 0 ? '' : 'none'; }
            updateDownloadSelectedButtonState();
        });
        clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; searchInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); searchInput.focus(); });
    }

    // --- DYNAMIC SCROLL BUTTONS ---
    const scrollPageBtn = document.getElementById('scrollPageBtn');
    const scrollBufferBtn = document.getElementById('scrollBufferBtn');
    if (scrollPageBtn) { const updatePageScrollBtn = () => { const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight; scrollPageBtn.classList.toggle('visible', scrollableHeight > 50); const atBottom = window.scrollY > scrollableHeight - 50; scrollPageBtn.classList.toggle('scroll-to-top', atBottom); scrollPageBtn.title = atBottom ? 'Scroll to Top' : 'Scroll to Bottom'; }; scrollPageBtn.addEventListener('click', () => { window.scrollTo({ top: scrollPageBtn.classList.contains('scroll-to-top') ? 0 : document.body.scrollHeight, behavior: 'smooth' }); }); window.addEventListener('scroll', updatePageScrollBtn, { passive: true }); updatePageScrollBtn(); }
    if (scrollBufferBtn && sharedTextArea) { const updateBufferScrollBtn = () => { const scrollableHeight = sharedTextArea.scrollHeight - sharedTextArea.clientHeight; scrollBufferBtn.classList.toggle('visible', scrollableHeight > 10); const atBottom = sharedTextArea.scrollTop > scrollableHeight - 10; scrollBufferBtn.classList.toggle('scroll-to-top', atBottom); scrollBufferBtn.title = atBottom ? 'Scroll to Top' : 'Scroll to End'; }; scrollBufferBtn.addEventListener('click', () => { sharedTextArea.scrollTo({ top: scrollBufferBtn.classList.contains('scroll-to-top') ? 0 : sharedTextArea.scrollHeight, behavior: 'smooth' }); }); sharedTextArea.addEventListener('scroll', updateBufferScrollBtn, { passive: true }); sharedTextArea.addEventListener('input', updateBufferScrollBtn); updateBufferScrollBtn(); scrollBufferBtn.handler = updateBufferScrollBtn; }

    // --- FILE LOCKING & PASSWORD MODAL ---
    const passwordModal = document.getElementById('passwordModal');
    const passwordModalForm = document.getElementById('passwordModalForm');
    const closePasswordModalBtn = document.getElementById('closePasswordModal');
    const passwordModalFilename = document.getElementById('passwordModalFilename');
    const filePasswordInput = document.getElementById('filePasswordInput');
    const passwordModalError = document.getElementById('passwordModalError');
    const downloadTable = document.getElementById('downloadSelectedForm');

    function openPasswordModal(filename) { passwordModalFilename.value = filename; filePasswordInput.value = ''; passwordModalError.textContent = ''; passwordModal.classList.add('visible'); filePasswordInput.focus(); }
    function closePasswordModal() { passwordModal.classList.remove('visible'); }

    if (passwordModal) { closePasswordModalBtn.addEventListener('click', closePasswordModal); passwordModal.addEventListener('click', (e) => { if (e.target === passwordModal) closePasswordModal(); }); }

    if (downloadTable) {
        downloadTable.addEventListener('click', async (e) => {
            const downloadLink = e.target.closest('.file-download-link');
            const lockButton = e.target.closest('.file-lock-btn');
            if (downloadLink) {
                e.preventDefault();
                const filename = downloadLink.dataset.filename;
                try {
                    const response = await fetch(`/api/file/status/${filename}`);
                    const data = await response.json();
                    if (data.locked) { openPasswordModal(filename); }
                    else { window.location.href = downloadLink.href; }
                } catch (error) { console.error("Failed to check file status:", error); setStatus('[ERR] Could not verify file status.', 'error'); }
            }
            if (lockButton) {
                const filename = lockButton.dataset.filename;
                const isCurrentlyLocked = lockButton.title.includes('Unlock');
                if (isCurrentlyLocked) {
                    const confirmed = await snailConfirm('Unlock File', `Are you sure you want to unlock "${decodeURIComponent(filename)}"?`);
                    if (confirmed) {
                        await fetch(`/api/file/unlock/${filename}`, { method: 'POST' });
                    }
                } else {
                    const password = await snailPrompt('Lock File', `Enter a password to lock "${decodeURIComponent(filename)}":`, { type: 'password', placeholder: 'Enter password...', confirmText: 'Lock' });
                    if (password) {
                        await fetch(`/api/file/lock/${filename}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
                    }
                }
            }
        });
    }

    if (passwordModalForm) {
        passwordModalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const filename = passwordModalFilename.value;
            const password = filePasswordInput.value;
            const submitBtn = passwordModalForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';
            passwordModalError.textContent = '';
            try {
                const response = await fetch(`/api/file/download_locked/${filename}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = decodeURIComponent(filename);
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                    closePasswordModal();
                } else if (response.status === 403) {
                    passwordModalError.textContent = 'Incorrect password. Please try again.';
                } else {
                    const result = await response.json();
                    passwordModalError.textContent = result.error || 'An unexpected error occurred.';
                }
            } catch (error) { passwordModalError.textContent = 'Network error. Please try again.'; }
            finally { submitBtn.disabled = false; submitBtn.textContent = 'Download'; }
        });
    }

    // --- FILE MOVE MODAL ---
    const moveFileModal = document.getElementById('moveFileModal');
    const closeMoveModalBtn = document.getElementById('closeMoveModal');
    const folderPickerList = document.getElementById('folderPickerList');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const moveFileSource = document.getElementById('moveFileSource');
    const moveFileName = document.getElementById('moveFileName');
    const moveModalError = document.getElementById('moveModalError');
    let selectedDestPath = null;

    function openMoveModal(filename, sourcePath) {
        if (!moveFileModal) return;
        moveFileName.value = filename;
        moveFileSource.value = sourcePath;
        moveModalError.textContent = '';
        confirmMoveBtn.disabled = true;
        selectedDestPath = null;
        folderPickerList.innerHTML = '<div class="spinner"></div>';
        moveFileModal.classList.add('visible');

        // Fetch all folders
        fetch('/api/folders/list')
            .then(res => res.json())
            .then(data => {
                if (!data.success) throw new Error(data.error || 'Failed to load folders.');
                const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
                folderPickerList.innerHTML = data.folders.map(f =>
                    `<button class="folder-picker-item" data-path="${f.path}" title="${f.name || 'Root'}">${folderIcon} ${f.name || 'Root'}</button>`
                ).join('');

                // Bind click on each folder item
                folderPickerList.querySelectorAll('.folder-picker-item').forEach(item => {
                    item.addEventListener('click', () => {
                        folderPickerList.querySelectorAll('.folder-picker-item').forEach(i => i.classList.remove('selected'));
                        item.classList.add('selected');
                        selectedDestPath = item.dataset.path;
                        confirmMoveBtn.disabled = false;
                        moveModalError.textContent = '';
                    });
                });
            })
            .catch(err => {
                folderPickerList.innerHTML = `<p style="padding:1rem; color:var(--c-error-text);">Error loading folders.</p>`;
                console.error('Error fetching folders:', err);
            });
    }

    function closeMoveModal() {
        if (moveFileModal) moveFileModal.classList.remove('visible');
    }

    if (moveFileModal) {
        closeMoveModalBtn.addEventListener('click', closeMoveModal);
        moveFileModal.addEventListener('click', (e) => { if (e.target === moveFileModal) closeMoveModal(); });
    }

    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener('click', async () => {
            if (selectedDestPath === null) return;
            const filename = moveFileName.value;
            const sourcePath = moveFileSource.value;

            // Don't move to the same folder
            if (selectedDestPath === sourcePath) {
                moveModalError.textContent = 'File is already in this folder.';
                return;
            }

            confirmMoveBtn.disabled = true;
            confirmMoveBtn.textContent = 'Moving...';
            moveModalError.textContent = '';
            try {
                const response = await fetch('/api/file/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename, source_path: sourcePath, dest_path: selectedDestPath })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to move file.');
                closeMoveModal();
                setStatus(`[OK] ${result.message}`, 'success');
            } catch (error) {
                moveModalError.textContent = error.message;
                console.error('Error moving file:', error);
            } finally {
                confirmMoveBtn.disabled = false;
                confirmMoveBtn.textContent = 'Move Here';
            }
        });
    }

    // --- INITIAL PAGE LOAD SETUP ---
    function initializePage() {
        loadSharedText().then(() => { if (scrollBufferBtn && scrollBufferBtn.handler) setTimeout(() => scrollBufferBtn.handler(), 100); });
        updateTextMeta();
        fileUploaded();
        switchView('shared');
        if (document.getElementById('downloadSelectedForm')) {
            reinitializeFileActions();
        }
        if (commitBtn) commitBtn.addEventListener('click', commitSharedText);
        if (selectBtn) selectBtn.addEventListener('click', selectSharedText);
        if (clearBtn) clearBtn.addEventListener('click', clearSharedText);
        if (pasteBtn) {
            pasteBtn.addEventListener('click', async () => {
                try {
                    let pastedText = null;
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        try {
                            pastedText = await navigator.clipboard.readText();
                        } catch (err) {
                            console.warn('Clipboard readText failed:', err);
                        }
                    }
                    if (pastedText !== null) {
                        if (isEditorMode && easyMDEInstance) {
                            const current = easyMDEInstance.value();
                            easyMDEInstance.value(current + pastedText);
                        } else {
                            sharedTextArea.value += pastedText;
                        }
                        updateTextMeta();
                        setStatus('[OK] Text pasted from clipboard.', 'success');
                    } else {
                        setStatus('[INFO] Could not read clipboard. Use Ctrl+V to paste.', 'info');
                    }
                } catch (error) {
                    console.error('Paste failed:', error);
                    setStatus('[INFO] Could not read clipboard. Use Ctrl+V to paste.', 'info');
                }
            });
        }
        if (pinBtn) pinBtn.addEventListener('click', handlePinClick);
        if (viewBtnShared) viewBtnShared.addEventListener('click', () => switchView('shared'));
        if (viewBtnPinned) viewBtnPinned.addEventListener('click', () => switchView('pinned'));
        if (viewBtnAiChat) viewBtnAiChat.addEventListener('click', () => switchView('ai'));
        if (fileInput) fileInput.addEventListener('change', fileUploaded);

        // --- QOL: Enter to Commit, Shift+Enter for Newline ---
        if (sharedTextArea && commitBtn) {
            sharedTextArea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitBtn.click();
                }
            });
        }

        // --- QOL: Paste Image from Clipboard to Upload ---
        if (sharedTextArea && fileInput) {
            document.addEventListener('paste', (e) => {
                const items = (e.clipboardData || window.clipboardData).items;
                if (!items) return;

                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        const imageFile = items[i].getAsFile();
                        if (imageFile) {
                            e.preventDefault();

                            const now = new Date();
                            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

                            const year = now.getFullYear();
                            const month = monthNames[now.getMonth()];
                            const day = String(now.getDate()).padStart(2, '0');
                            const hours = String(now.getHours()).padStart(2, '0');
                            const minutes = String(now.getMinutes()).padStart(2, '0');
                            const seconds = String(now.getSeconds()).padStart(2, '0');

                            const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
                            const fileExtension = imageFile.type.split('/')[1] || 'png';
                            const newFilename = `Picture-${timestamp}.${fileExtension}`;

                            const newFile = new File([imageFile], newFilename, { type: imageFile.type });

                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(newFile);
                            fileInput.files = dataTransfer.files;

                            fileUploaded();
                            setStatus('[OK] Image from clipboard is ready to upload.', 'success');

                            break;
                        }
                    }
                }
            });
        }

        // --- BATCH ACTIONS (LOCK/UNLOCK/DELETE) ---
        const lockSelectedBtn = document.getElementById('lockSelectedBtn');
        const unlockSelectedBtn = document.getElementById('unlockSelectedBtn');
        const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

        if (lockSelectedBtn) {
            lockSelectedBtn.addEventListener('click', async () => {
                const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
                if (selectedFiles.length === 0) return;
                const password = await snailPrompt('Lock Files', `Enter a password to lock the ${selectedFiles.length} selected file(s):`, { type: 'password', placeholder: 'Enter password...', confirmText: 'Lock' });
                if (password) {
                    try {
                        const response = await fetch('/api/files/lock_batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filenames: selectedFiles, password: password })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || 'Server error');
                        flash(`[OK] ${result.details.locked.length} file(s) locked successfully.`, 'success');
                        if (result.details.failed.length > 0) flash(`[WARN] ${result.details.failed.length} file(s) could not be locked.`, 'warning');
                        // No reload needed
                    } catch (error) { flash(`[ERR] Lock operation failed: ${error.message}`, 'error'); }
                }
            });
        }

        if (unlockSelectedBtn) {
            unlockSelectedBtn.addEventListener('click', async () => {
                const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
                if (selectedFiles.length === 0) return;
                const password = await snailPrompt('Unlock Files', `Enter the password to unlock the ${selectedFiles.length} selected file(s):`, { type: 'password', placeholder: 'Enter password...', confirmText: 'Unlock' });
                if (password) {
                    try {
                        const response = await fetch('/api/files/unlock_batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filenames: selectedFiles, password: password })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || 'Server error');
                        flash(`[OK] ${result.details.unlocked.length} file(s) unlocked successfully.`, 'success');
                        if (result.details.failed.length > 0) flash(`[WARN] ${result.details.failed.length} file(s) failed to unlock (wrong password or not locked).`, 'warning');
                        // No reload needed
                    } catch (error) { flash(`[ERR] Unlock operation failed: ${error.message}`, 'error'); }
                }
            });
        }

        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', async () => {
                const selectedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
                const selectedFiles = Array.from(selectedCheckboxes).map(cb => cb.value);
                if (selectedFiles.length === 0) return;
                const fileListString = selectedFiles.map(name => `- ${decodeURIComponent(name)}`).join('\n');
                if (confirm(`Are you sure you want to permanently delete these ${selectedFiles.length} files?\n\n${fileListString}`)) {
                    try {
                        const response = await fetch('/api/files/delete_batch', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filenames: selectedFiles })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || 'Server error');
                        flash(`[OK] ${result.details.deleted.length} file(s) deleted successfully.`, 'success');
                        if (result.details.failed.length > 0) flash(`[WARN] ${result.details.failed.length} file(s) could not be deleted.`, 'warning');
                        // No manual removal needed
                    } catch (error) { flash(`[ERR] Delete operation failed: ${error.message}`, 'error'); }
                }
            });
        }

        // --- AI CHAT FUNCTIONALITY ---
        function parseMarkdown(text) {
            // Use marked.js for proper markdown rendering
            if (typeof marked !== 'undefined') {
                marked.setOptions({
                    breaks: true,
                    gfm: true
                });
                return marked.parse(text);
            }
            // Minimal fallback if marked.js fails to load
            return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function toggleAiChatMode() {
            if (currentView === 'ai') {
                switchView('shared');
            } else {
                switchView('ai');
            }
        }

        function renderAiChatMessage(message, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `ai-chat-message ${sender}`;

            const bubble = document.createElement('div');
            bubble.className = 'ai-chat-bubble';

            // Use innerHTML for AI messages to render markdown, textContent for user messages
            if (sender === 'ai') {
                bubble.innerHTML = '<div class="markdown-content">' + parseMarkdown(message) + '</div>';
            } else {
                bubble.textContent = message;
            }

            // Create action buttons container
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'ai-chat-actions';

            // Copy button icon SVGs
            const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            const checkIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

            // Copy button (for both user and AI messages)
            const copyBtn = document.createElement('button');
            copyBtn.className = 'ai-chat-action-btn copy-btn';
            copyBtn.title = 'Copy message';
            copyBtn.innerHTML = copyIconSvg;
            copyBtn.addEventListener('click', async () => {
                const copied = await copyToClipboard(message);
                if (copied) {
                    copyBtn.innerHTML = checkIconSvg;
                    flash('[OK] Message copied to clipboard.', 'success');
                    setTimeout(() => { copyBtn.innerHTML = copyIconSvg; }, 2000);
                } else {
                    flash('[ERR] Failed to copy.', 'error');
                }
            });
            actionsDiv.appendChild(copyBtn);

            if (sender === 'user') {
                // Edit button for user messages
                const editBtn = document.createElement('button');
                editBtn.className = 'ai-chat-action-btn edit-btn';
                editBtn.title = 'Edit message';
                editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
                editBtn.addEventListener('click', () => {
                    aiChatInput.value = message;
                    aiChatInput.focus();
                    flash('[OK] Message loaded in input. Edit and resend.', 'info');
                });
                actionsDiv.appendChild(editBtn);
            }

            const timestamp = document.createElement('div');
            timestamp.className = 'ai-chat-timestamp';
            const now = new Date();
            timestamp.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            messageDiv.appendChild(bubble);
            messageDiv.appendChild(actionsDiv);
            messageDiv.appendChild(timestamp);

            // Remove empty state if it exists
            const emptyState = aiChatMessages.querySelector('.ai-chat-empty');
            if (emptyState) {
                emptyState.remove();
            }

            aiChatMessages.appendChild(messageDiv);
            aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
        }

        function showAiChatLoading() {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'ai-chat-loading';
            loadingDiv.id = 'aiChatLoading';
            loadingDiv.innerHTML = `
                <div class="ai-chat-loading-dots">
                    <div class="ai-chat-loading-dot"></div>
                    <div class="ai-chat-loading-dot"></div>
                    <div class="ai-chat-loading-dot"></div>
                </div>
                <span>Gemini is thinking...</span>
            `;
            aiChatMessages.appendChild(loadingDiv);
            aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
        }

        function hideAiChatLoading() {
            const loadingDiv = document.getElementById('aiChatLoading');
            if (loadingDiv) {
                loadingDiv.remove();
            }
        }

        async function sendAiChatMessage() {
            const message = aiChatInput.value.trim();
            if (!message || aiChatSendBtn.disabled) return;

            // Disable input while processing
            aiChatInput.disabled = true;
            aiChatSendBtn.disabled = true;
            aiChatSendBtn.textContent = 'Sending...';

            // Render user message
            renderAiChatMessage(message, 'user');
            aiChatInput.value = '';

            // Show loading indicator
            showAiChatLoading();

            try {
                const response = await fetch('/api/ai-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: message,
                        history: aiChatHistory
                    })
                });

                const result = await response.json();
                hideAiChatLoading();

                if (result.success) {
                    // Render AI response
                    renderAiChatMessage(result.response, 'ai');

                    // Update chat history for context
                    aiChatHistory.push({
                        role: 'user',
                        parts: [{ text: message }]
                    });
                    aiChatHistory.push({
                        role: 'model',
                        parts: [{ text: result.response }]
                    });

                    // Keep only last 10 exchanges (20 messages) for context
                    if (aiChatHistory.length > 20) {
                        aiChatHistory = aiChatHistory.slice(-20);
                    }
                } else {
                    // Show error message
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'ai-chat-message ai';
                    errorDiv.innerHTML = `
                        <div class="ai-chat-bubble" style="border-color: var(--c-error); color: var(--c-error-text);">
                            ❌ ${result.error || 'Failed to get AI response'}
                        </div>
                    `;
                    aiChatMessages.appendChild(errorDiv);
                    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
                }
            } catch (error) {
                hideAiChatLoading();
                console.error('Error sending AI chat message:', error);

                const errorDiv = document.createElement('div');
                errorDiv.className = 'ai-chat-message ai';
                errorDiv.innerHTML = `
                    <div class="ai-chat-bubble" style="border-color: var(--c-error); color: var(--c-error-text);">
                        ❌ Network error. Please check your connection and try again.
                    </div>
                `;
                aiChatMessages.appendChild(errorDiv);
                aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
            } finally {
                // Re-enable input
                aiChatInput.disabled = false;
                aiChatSendBtn.disabled = false;
                aiChatSendBtn.textContent = 'Send';
                aiChatInput.focus();
            }
        }

        // AI Chat toggle is handled by viewBtnAiChat click listener bound above

        if (aiChatSendBtn) {
            aiChatSendBtn.addEventListener('click', sendAiChatMessage);
        }

        if (aiChatInput) {
            aiChatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAiChatMessage();
                }
            });

            // Auto-resize textarea as user types
            aiChatInput.addEventListener('input', () => {
                aiChatInput.style.height = 'auto';
                aiChatInput.style.height = Math.min(aiChatInput.scrollHeight, 80) + 'px';
            });
        }

        // Reset Chat Button
        const resetChatBtn = document.getElementById('resetChatBtn');
        if (resetChatBtn) {
            resetChatBtn.addEventListener('click', () => {
                // Clear chat history
                aiChatHistory = [];

                // Clear messages and restore empty state
                if (aiChatMessages) {
                    aiChatMessages.innerHTML = `
                        <div class="ai-chat-empty">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <p>Start a conversation with Gemini AI</p>
                        </div>
                    `;
                }

                // Clear input
                if (aiChatInput) {
                    aiChatInput.value = '';
                }

                flash('[OK] Chat reset.', 'success');
            });
        }

        // --- MARKDOWN EDITOR FUNCTIONALITY ---
        function toggleEditorMode() {
            isEditorMode = !isEditorMode;

            if (isEditorMode) {
                // Exit preview mode first if active
                if (isPreviewMode) {
                    isPreviewMode = false;
                    markdownPreview.classList.add('view-hidden');
                    sharedTextArea.classList.remove('preview-active');
                    previewBtn.classList.remove('active');
                }

                // Hide the preview button (EasyMDE has its own)
                if (previewBtn) {
                    previewBtn.style.display = 'none';
                }

                // Switch to editor mode
                initializeMarkdownEditor();
                editorBtn.textContent = 'Plain Text';
                editorBtn.classList.add('active');
            } else {
                // Switch back to plain text mode
                destroyMarkdownEditor();
                editorBtn.textContent = 'Editor';
                editorBtn.classList.remove('active');

                // Show the preview button again
                if (previewBtn) {
                    previewBtn.style.display = '';
                }
            }
        }

        function initializeMarkdownEditor() {
            if (easyMDEInstance) return; // Already initialized

            easyMDEInstance = new EasyMDE({
                element: sharedTextArea,
                spellChecker: false,
                autofocus: true,
                placeholder: "Type your markdown here...",
                status: ['lines', 'words', 'cursor'],
                toolbar: [
                    'bold', 'italic', 'heading', '|',
                    'quote', 'unordered-list', 'ordered-list', '|',
                    'link', 'image', '|',
                    'preview', '|',
                    {
                        name: 'download',
                        action: function downloadMarkdown(editor) {
                            const content = editor.value();
                            if (!content.trim()) {
                                flash('[INFO] Nothing to download - editor is empty.', 'info');
                                return;
                            }

                            // Create sanitized filename with timestamp (no directory traversal possible)
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                            const filename = `note_${timestamp}.md`;

                            // Create blob and trigger download
                            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);

                            flash('[OK] Markdown file downloaded.', 'success');
                        },
                        className: 'fa fa-download',
                        title: 'Download as Markdown'
                    }
                ],
                renderingConfig: {
                    codeSyntaxHighlighting: true,
                },
                // Sync editor changes with textarea
                onChange: () => {
                    updateTextMeta();
                }
            });
        }

        function destroyMarkdownEditor() {
            if (easyMDEInstance) {
                const content = easyMDEInstance.value();
                easyMDEInstance.toTextArea();
                easyMDEInstance = null;
                sharedTextArea.value = content;
                updateTextMeta();
            }
        }

        // Editor button event listener
        if (editorBtn) {
            editorBtn.addEventListener('click', toggleEditorMode);
        }

        // --- MARKDOWN PREVIEW FUNCTIONALITY ---
        function togglePreviewMode() {
            isPreviewMode = !isPreviewMode;

            if (isPreviewMode) {
                // Exit editor mode first if active
                if (isEditorMode) {
                    destroyMarkdownEditor();
                    isEditorMode = false;
                    editorBtn.textContent = 'Editor';
                    editorBtn.classList.remove('active');
                }

                // Get text content and parse markdown
                const textContent = sharedTextArea.value;
                const parsedHtml = parseMarkdownExtended(textContent);

                // Show preview, hide textarea
                markdownPreview.innerHTML = parsedHtml;
                markdownPreview.classList.remove('view-hidden');
                sharedTextArea.classList.add('preview-active');

                previewBtn.classList.add('active');
            } else {
                // Hide preview, show textarea
                markdownPreview.classList.add('view-hidden');
                sharedTextArea.classList.remove('preview-active');

                previewBtn.classList.remove('active');
            }
        }

        // Extended markdown parser for preview (more comprehensive than AI chat parser)
        function parseMarkdownExtended(text) {
            if (!text || !text.trim()) {
                return '<p style="color: var(--c-text-muted); font-style: italic;">Nothing to preview. Type some text to see the markdown rendered.</p>';
            }

            let html = text;

            // Code blocks with language (must be done first)
            html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                return `<pre><code class="language-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`;
            });

            // Inline code (avoid matching inside code blocks)
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

            // Headers
            html = html.replace(/^###### (.*$)/gm, '<h6>$1</h6>');
            html = html.replace(/^##### (.*$)/gm, '<h5>$1</h5>');
            html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>');
            html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

            // Bold and Italic (order matters)
            html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
            html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

            // Strikethrough
            html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

            // Blockquotes
            html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');

            // Horizontal rules
            html = html.replace(/^---$/gm, '<hr>');
            html = html.replace(/^\*\*\*$/gm, '<hr>');

            // Unordered lists
            html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
            html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

            // Ordered lists
            html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

            // Wrap consecutive <li> in <ul>
            html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

            // Links [text](url)
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

            // Images ![alt](url)
            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

            // Paragraphs (wrap text not in tags)
            html = html.split('\n\n').map(para => {
                if (para.trim() && !para.match(/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|div)/)) {
                    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
                }
                return para;
            }).join('\n');

            return html;
        }

        // Preview button event listener
        if (previewBtn) {
            previewBtn.addEventListener('click', togglePreviewMode);
        }
    }

    initializePage();
}); 