// Enhanced Notes Editor with Search, Context Menu, Download, Rename, Duplicate
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('notesList')) return;

    // Elements
    const notesList = document.getElementById('notesList');
    const newNoteBtn = document.getElementById('newNoteBtn');
    const newFolderBtn = document.getElementById('newFolderBtn');
    const editorPlaceholder = document.getElementById('editorPlaceholder');
    const editorContainer = document.getElementById('editorContainer');
    const noteTitle = document.getElementById('noteTitle');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const searchInput = document.getElementById('searchNotes');
    const contextMenu = document.getElementById('contextMenu');
    const unsavedModal = document.getElementById('unsavedModal');
    const modalSaveBtn = document.getElementById('modalSaveBtn');
    const modalDiscardBtn = document.getElementById('modalDiscardBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const promptModal = document.getElementById('promptModal');
    const promptTitle = document.getElementById('promptTitle');
    const promptMessage = document.getElementById('promptMessage');
    const promptInput = document.getElementById('promptInput');
    const promptConfirmBtn = document.getElementById('promptConfirmBtn');
    const promptCancelBtn = document.getElementById('promptCancelBtn');
    const confirmModal = document.getElementById('confirmModal');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmYesBtn = document.getElementById('confirmYesBtn');
    const confirmNoBtn = document.getElementById('confirmNoBtn');

    // State
    let quill;
    let currentNote = null;
    let notes = [];
    let contextMenuTarget = null;
    let selectedNotes = new Set();
    let draggedNote = null;
    let hasUnsavedChanges = false;
    let originalContent = '';

    // Initialize Quill
    quill = new Quill('#editor', {
        theme: 'snow',
        placeholder: 'Start writing...',
        modules: {
            toolbar: [
                [{ 'header': [1, 2, 3, false] }],
                [{ 'size': ['small', false, 'large', 'huge'] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                [{ 'color': [] }, { 'background': [] }],
                ['blockquote', 'code-block'],
                ['link', 'image'],
                ['clean']
            ]
        }
    });

    // Track changes to detect unsaved edits
    quill.on('text-change', () => {
        if (currentNote && quill.root.innerHTML !== originalContent) {
            hasUnsavedChanges = true;
        }
    });

    // Custom modal for unsaved changes
    function showUnsavedModal() {
        return new Promise((resolve) => {
            unsavedModal.classList.add('visible');

            const handleSave = () => {
                cleanup();
                resolve('save');
            };

            const handleDiscard = () => {
                cleanup();
                resolve('discard');
            };

            const handleCancel = () => {
                cleanup();
                resolve('cancel');
            };

            const cleanup = () => {
                unsavedModal.classList.remove('visible');
                modalSaveBtn.removeEventListener('click', handleSave);
                modalDiscardBtn.removeEventListener('click', handleDiscard);
                modalCancelBtn.removeEventListener('click', handleCancel);
            };

            modalSaveBtn.addEventListener('click', handleSave);
            modalDiscardBtn.addEventListener('click', handleDiscard);
            modalCancelBtn.addEventListener('click', handleCancel);
        });
    }

    // Custom prompt modal
    function showPromptModal(title, message, defaultValue = '') {
        return new Promise((resolve) => {
            promptTitle.textContent = title;
            promptMessage.textContent = message;
            promptInput.value = defaultValue;
            promptInput.placeholder = 'Enter name...';
            promptModal.classList.add('visible');

            // Focus input after animation
            setTimeout(() => promptInput.focus(), 100);

            const handleConfirm = () => {
                const value = promptInput.value.trim();
                cleanup();
                resolve(value || null);
            };

            const handleCancel = () => {
                cleanup();
                resolve(null);
            };

            const handleKeydown = (e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
            };

            const cleanup = () => {
                promptModal.classList.remove('visible');
                promptConfirmBtn.removeEventListener('click', handleConfirm);
                promptCancelBtn.removeEventListener('click', handleCancel);
                promptInput.removeEventListener('keydown', handleKeydown);
            };

            promptConfirmBtn.addEventListener('click', handleConfirm);
            promptCancelBtn.addEventListener('click', handleCancel);
            promptInput.addEventListener('keydown', handleKeydown);
        });
    }

    // Custom confirm modal
    function showConfirmModal(title, message) {
        return new Promise((resolve) => {
            confirmTitle.textContent = title;
            confirmMessage.textContent = message;
            confirmModal.classList.add('visible');

            const handleYes = () => {
                cleanup();
                resolve(true);
            };

            const handleNo = () => {
                cleanup();
                resolve(false);
            };

            const handleKeydown = (e) => {
                if (e.key === 'Escape') handleNo();
            };

            const cleanup = () => {
                confirmModal.classList.remove('visible');
                confirmYesBtn.removeEventListener('click', handleYes);
                confirmNoBtn.removeEventListener('click', handleNo);
                document.removeEventListener('keydown', handleKeydown);
            };

            confirmYesBtn.addEventListener('click', handleYes);
            confirmNoBtn.addEventListener('click', handleNo);
            document.addEventListener('keydown', handleKeydown);
        });
    }

    // API
    async function api(endpoint, method = 'GET', body = null) {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`/admin/api/notes/${endpoint}`, options);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    // Load notes list
    let rootTree = [];
    let currentFilter = 'all';

    async function loadNotes() {
        try {
            const data = await api('tree');
            rootTree = data.tree;
            renderNotesList();
            updateFilterDropdown();
        } catch (error) {
            console.error('Failed to load notes:', error);
            notesList.innerHTML = '<p class="loading">Failed to load notes</p>';
        }
    }

    function renderNotesList() {
        if (!rootTree || rootTree.length === 0) {
            notesList.innerHTML = '<p class="loading">No notes yet</p>';
            return;
        }

        let html = '';

        function renderItems(items, level = 0) {
            // Sort: folders first, then files
            const sorted = [...items].sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'folder' ? -1 : 1;
            });

            sorted.forEach(item => {
                const padding = 1 + (level * 1.5); // Base 1rem + 1.5rem per level

                if (item.type === 'folder') {
                    // Check if we should show this folder based on filter
                    if (currentFilter !== 'all' && item.name !== currentFilter && level === 0) return;

                    html += `<div class="note-item folder" data-path="${item.path}" style="padding-left: ${padding}rem">
                        <span class="folder-icon">📁</span>
                        <span class="folder-name">${item.name}</span>
                    </div>`;

                    if (item.children) {
                        renderItems(item.children, level + 1);
                    }
                } else {
                    // If filtering, only show if parent matches or we are inside a matching folder
                    if (currentFilter !== 'all') {
                        const parts = item.path.split('/');
                        if (parts[0] !== currentFilter) return;
                    }

                    html += `<div class="note-item" data-path="${item.path}" data-type="file" style="padding-left: ${padding}rem" draggable="true">
                        <input type="checkbox" class="note-checkbox" data-path="${item.path}">
                        <div class="note-item-title">${item.name}</div>
                    </div>`;
                }
            });
        }

        renderItems(rootTree);
        notesList.innerHTML = html;
    }

    function updateFilterDropdown() {
        // Get unique folder names from top level of tree
        const folderNames = new Set();
        rootTree.forEach(item => {
            if (item.type === 'folder') {
                folderNames.add(item.name);
            }
        });

        if (folderNames.size === 0) return;

        let filterContainer = document.getElementById('filterContainer');
        if (!filterContainer) {
            filterContainer = document.createElement('div');
            filterContainer.id = 'filterContainer';
            filterContainer.className = 'filter-container';
            const searchContainer = document.querySelector('.search-container');
            searchContainer.parentNode.insertBefore(filterContainer, searchContainer.nextSibling);
        }

        let html = `
            <label for="folderFilter" class="filter-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                Filter:
            </label>
            <select id="folderFilter" class="filter-select">
                <option value="all">All Notes</option>
        `;

        Array.from(folderNames).sort().forEach(folder => {
            html += `<option value="${folder}">${folder}</option>`;
        });

        html += `</select>`;
        filterContainer.innerHTML = html;

        const filterSelect = document.getElementById('folderFilter');
        if (filterSelect) {
            filterSelect.value = currentFilter;
            filterSelect.addEventListener('change', (e) => {
                currentFilter = e.target.value;
                renderNotesList();
            });
        }
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const items = document.querySelectorAll('.note-item');

        items.forEach(item => {
            const titleEl = item.querySelector('.note-item-title');
            const folderNameEl = item.querySelector('.folder-name');
            let text = '';

            if (titleEl) text = titleEl.textContent.toLowerCase();
            else if (folderNameEl) text = folderNameEl.textContent.toLowerCase();

            item.classList.toggle('hidden', !text.includes(query));
        });
    });

    // Load note
    async function loadNote(path) {
        // Check for unsaved changes before switching
        if (hasUnsavedChanges && currentNote) {
            const choice = await showUnsavedModal();

            if (choice === 'save') {
                await saveNote();
            } else if (choice === 'cancel') {
                return; // Don't switch notes
            }
            // 'discard' falls through to load the new note
            hasUnsavedChanges = false;
        }

        try {
            const data = await api(`note?path=${encodeURIComponent(path)}`);
            currentNote = path;
            noteTitle.value = path.split('/').pop().replace('.md', '');
            quill.root.innerHTML = data.content || '';
            originalContent = quill.root.innerHTML; // Store original for change detection
            hasUnsavedChanges = false;

            editorPlaceholder.style.display = 'none';
            editorContainer.style.display = 'flex';

            document.querySelectorAll('.note-item').forEach(item => {
                item.classList.toggle('active', item.dataset.path === path);
            });
        } catch (error) {
            alert('Failed to load note');
        }
    }

    // Save note
    async function saveNote() {
        if (!currentNote) return;
        try {
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;
            await api('note', 'POST', {
                path: currentNote,
                content: quill.root.innerHTML
            });
            originalContent = quill.root.innerHTML; // Update original content after save
            hasUnsavedChanges = false;
            saveBtn.textContent = 'Saved!';
            setTimeout(() => { saveBtn.textContent = 'Save'; }, 1000);
        } catch (error) {
            alert('Failed to save');
            saveBtn.textContent = 'Save';
        } finally {
            saveBtn.disabled = false;
        }
    }

    // Create note
    async function createNote() {
        const folderNames = [];
        if (rootTree) {
            rootTree.forEach(item => {
                if (item.type === 'folder') {
                    folderNames.push(item.name);
                }
            });
        }

        let folder = '';

        if (folderNames.length > 0) {
            const choice = await showConfirmModal('Create Note', 'Would you like to create this note inside a folder?');
            if (choice) {
                // Create a simple select dialog
                const folderSelect = folderNames.map((f, i) => `${i + 1}. ${f}`).join(', ');
                const selection = await showPromptModal('Select Folder', `Enter folder number (${folderSelect}):`);
                if (selection) {
                    const index = parseInt(selection) - 1;
                    if (index >= 0 && index < folderNames.length) {
                        folder = folderNames[index] + '/';
                    }
                }
            }
        }

        const name = await showPromptModal('New Note', 'Enter note name (without .md):');
        if (!name) return;
        const path = `${folder}${name}.md`;

        try {
            await api('item', 'POST', { path, type: 'file' });
            await loadNotes();
            await loadNote(path);
        } catch (error) {
            alert('Failed to create note');
        }
    }

    // Create folder
    async function createFolder() {
        const name = await showPromptModal('New Folder', 'Enter folder name:');
        if (!name) return;

        try {
            await api('item', 'POST', { path: name, type: 'folder' });
            await loadNotes();
        } catch (error) {
            alert('Failed to create folder');
        }
    }

    // Delete note
    async function deleteNote(path = currentNote) {
        if (!path) return;
        const confirmed = await showConfirmModal('Delete Note', 'Are you sure you want to delete this note? This action cannot be undone.');
        if (!confirmed) return;

        try {
            await api('item', 'DELETE', { path });
            if (path === currentNote) {
                editorContainer.style.display = 'none';
                editorPlaceholder.style.display = 'flex';
                currentNote = null;
            }
            await loadNotes();
        } catch (error) {
            alert('Failed to delete');
        }
    }

    // Rename note
    async function renameNote(path) {
        const oldName = path.split('/').pop().replace('.md', '');
        const newName = await showPromptModal('Rename Note', 'Enter new name:', oldName);
        if (!newName || newName === oldName) return;

        try {
            await api('item', 'PUT', {
                old_path: path,
                new_name: `${newName}.md`
            });
            await loadNotes();
            const newPath = path.replace(oldName + '.md', newName + '.md');
            if (path === currentNote) {
                await loadNote(newPath);
            }
        } catch (error) {
            alert('Failed to rename');
        }
    }

    // Duplicate note
    async function duplicateNote(path) {
        const oldName = path.split('/').pop().replace('.md', '');
        const newName = await showPromptModal('Duplicate Note', 'Enter name for the copy:', `${oldName} (copy)`);
        if (!newName) return;

        try {
            // Load original content
            const data = await api(`note?path=${encodeURIComponent(path)}`);
            // Create new note
            await api('item', 'POST', { path: `${newName}.md`, type: 'file' });
            // Save content to new note
            await api('note', 'POST', {
                path: `${newName}.md`,
                content: data.content
            });
            await loadNotes();
        } catch (error) {
            alert('Failed to duplicate');
        }
    }

    // Download note
    async function downloadNote(path = currentNote) {
        if (!path) return;
        try {
            // Fetch note content from API
            const data = await api(`note?path=${encodeURIComponent(path)}`);

            // Convert HTML to markdown-like format (simple conversion)
            let content = data.content || '';

            // Remove HTML tags for basic markdown export
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const markdownContent = tempDiv.textContent || tempDiv.innerText || '';

            // Create and download markdown file
            const blob = new Blob([markdownContent], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path.split('/').pop(); // Keep .md extension
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('Failed to download note');
        }
    }

    // Export note as PDF
    async function exportNoteToPdf(path = currentNote) {
        if (!path) return;
        try {
            const data = await api(`note?path=${encodeURIComponent(path)}`);
            const filename = path.split('/').pop().replace('.md', '.pdf');

            // Create a styled container for PDF generation
            const container = document.createElement('div');
            container.innerHTML = data.content || '';
            container.style.padding = '20px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '12pt';
            container.style.lineHeight = '1.6';
            container.style.color = '#333';

            const opt = {
                margin: 15,
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            await html2pdf().set(opt).from(container).save();
        } catch (error) {
            console.error('PDF export error:', error);
            alert('Failed to export PDF');
        }
    }

    // Context menu
    function showContextMenu(e, path) {
        e.preventDefault();
        contextMenuTarget = path;
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.classList.add('visible');
    }

    function hideContextMenu() {
        contextMenu.classList.remove('visible');
        contextMenuTarget = null;
    }

    // Folder context menu
    function showFolderContextMenu(e, folderPath) {
        const menu = document.createElement('div');
        menu.className = 'context-menu visible';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.innerHTML = `
            <div class="context-menu-item" data-action="create-in-folder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New Note Here
            </div>
        `;

        document.body.appendChild(menu);

        menu.addEventListener('click', async (ev) => {
            const action = ev.target.closest('.context-menu-item')?.dataset.action;
            if (action === 'create-in-folder') {
                const name = prompt('Note name (without .md):');
                if (name) {
                    const path = `${folderPath}/${name}.md`;
                    try {
                        await api('item', 'POST', { path, type: 'file' });
                        await loadNotes();
                        await loadNote(path);
                    } catch (error) {
                        alert('Failed to create note');
                    }
                }
            }
            menu.remove();
        });

        document.addEventListener('click', () => menu.remove(), { once: true });
    }

    // Drag and drop functionality
    let draggedItem = null;

    notesList.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.note-item');
        if (item && item.dataset.type === 'file') {
            draggedItem = item.dataset.path;
            item.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        }
    });

    notesList.addEventListener('dragend', (e) => {
        const item = e.target.closest('.note-item');
        if (item) {
            item.style.opacity = '1';
        }
        draggedItem = null;
        // Remove any drop zone highlights
        notesList.classList.remove('drop-zone-active');
        document.querySelectorAll('.note-item.folder').forEach(f => f.style.background = '');
    });

    notesList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const item = e.target.closest('.note-item');

        // Highlight folder when hovering over it
        if (item && item.classList.contains('folder')) {
            item.style.background = 'rgba(220, 38, 38, 0.1)';
        } else if (draggedItem && draggedItem.includes('/')) {
            // If file is from a folder and hovering on empty space, show root drop zone
            notesList.classList.add('drop-zone-active');
        }
    });

    notesList.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.note-item');
        if (item && item.classList.contains('folder')) {
            item.style.background = '';
        }
        // Check if leaving the notes list entirely
        if (e.target === notesList || !notesList.contains(e.relatedTarget)) {
            notesList.classList.remove('drop-zone-active');
        }
    });

    notesList.addEventListener('drop', async (e) => {
        e.preventDefault();
        const item = e.target.closest('.note-item');

        // Clear all highlights
        notesList.classList.remove('drop-zone-active');
        document.querySelectorAll('.note-item.folder').forEach(f => f.style.background = '');

        if (!draggedItem) return;

        // Determine target location
        let targetPath = '';
        let targetLabel = 'root';

        if (item && item.classList.contains('folder')) {
            // Dropping into a folder
            targetPath = item.dataset.path;
            targetLabel = targetPath;
        } else {
            // Dropping to root level (empty space or on another file)
            // Only proceed if the dragged item is from a folder
            const currentFolder = draggedItem.includes('/') ? draggedItem.substring(0, draggedItem.lastIndexOf('/')) : '';
            if (!currentFolder) {
                // File is already at root, can't move to root
                return;
            }
            targetPath = '';
            targetLabel = 'root';
        }

        const fileName = draggedItem.split('/').pop();
        const currentFolder = draggedItem.includes('/') ? draggedItem.substring(0, draggedItem.lastIndexOf('/')) : '';

        // Check if trying to move to same location
        if (targetPath === currentFolder) {
            return; // Already in target folder
        }

        const newPath = targetPath ? `${targetPath}/${fileName}` : fileName;

        const confirmed = await showConfirmModal('Move Note', `Move "${fileName}" to ${targetLabel}?`);
        if (confirmed) {
            try {
                const response = await fetch('/admin/api/notes/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source_path: draggedItem,
                        dest_path: targetPath  // Send folder path, not full path with filename
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Move failed');
                }
                await loadNotes();
                if (draggedItem === currentNote) {
                    currentNote = newPath;
                    await loadNote(newPath);
                }
            } catch (error) {
                alert('Failed to move file: ' + error.message);
            }
        }
    });

    // Multi-select functionality
    notesList.addEventListener('change', (e) => {
        if (e.target.classList.contains('note-checkbox')) {
            const path = e.target.dataset.path;
            if (e.target.checked) {
                selectedNotes.add(path);
            } else {
                selectedNotes.delete(path);
            }
            updateBatchActions();
        }
    });

    function updateBatchActions() {
        const count = selectedNotes.size;
        if (count > 0) {
            // Show batch action buttons
            if (!document.getElementById('batchActions')) {
                const batchDiv = document.createElement('div');
                batchDiv.id = 'batchActions';
                batchDiv.className = 'batch-actions';
                batchDiv.innerHTML = `
                    <span class="batch-count">${count} selected</span>
                    <button id="batchDownload" class="btn btn-sm" title="Download selected notes">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button id="batchExportPdf" class="btn btn-sm" title="Export selected as PDF">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <path d="M9 15h6" />
                            <path d="M9 11h6" />
                        </svg>
                    </button>
                    <button id="batchDelete" class="btn btn-sm btn-danger" title="Delete selected notes">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                    <button id="clearSelection" class="btn btn-sm" title="Clear selection">Clear</button>
                `;
                document.querySelector('.notes-sidebar').insertBefore(batchDiv, notesList);

                document.getElementById('batchDownload').addEventListener('click', batchDownload);
                document.getElementById('batchExportPdf').addEventListener('click', batchExportPdf);
                document.getElementById('batchDelete').addEventListener('click', batchDelete);
                document.getElementById('clearSelection').addEventListener('click', clearSelection);
            } else {
                document.querySelector('.batch-count').textContent = `${count} selected`;
            }
        } else {
            document.getElementById('batchActions')?.remove();
        }
    }

    async function batchDownload() {
        for (const path of selectedNotes) {
            try {
                const data = await api(`note?path=${encodeURIComponent(path)}`);

                // Convert HTML to plain text markdown
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = data.content || '';
                const markdownContent = tempDiv.textContent || tempDiv.innerText || '';

                const blob = new Blob([markdownContent], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = path.split('/').pop(); // Keep .md extension
                a.click();
                URL.revokeObjectURL(url);

                // Small delay between downloads
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Failed to download:', path);
            }
        }
    }

    async function batchExportPdf() {
        for (const path of selectedNotes) {
            try {
                await exportNoteToPdf(path);
                // Delay between PDF exports to avoid browser issues
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error('Failed to export PDF:', path);
            }
        }
    }

    async function batchDelete() {
        const confirmed = await showConfirmModal('Delete Notes', `Are you sure you want to delete ${selectedNotes.size} notes? This action cannot be undone.`);
        if (!confirmed) return;

        for (const path of selectedNotes) {
            try {
                await api('item', 'DELETE', { path });
            } catch (error) {
                console.error('Failed to delete:', path);
            }
        }

        clearSelection();
        await loadNotes();
        if (selectedNotes.has(currentNote)) {
            editorContainer.style.display = 'none';
            editorPlaceholder.style.display = 'flex';
            currentNote = null;
        }
    }

    function clearSelection() {
        selectedNotes.clear();
        document.querySelectorAll('.note-checkbox').forEach(cb => cb.checked = false);
        updateBatchActions();
    }

    // Events
    notesList.addEventListener('click', (e) => {
        // Ignore checkbox clicks
        if (e.target.classList.contains('note-checkbox')) return;

        const item = e.target.closest('.note-item');
        if (!item) return;

        // Handle folder toggle
        if (item.classList.contains('folder')) {
            e.preventDefault();
            e.stopPropagation();
            item.classList.toggle('collapsed');
            const folderPath = item.dataset.path;
            const isCollapsed = item.classList.contains('collapsed');

            // Toggle visibility of child items based on collapsed state
            let nextItem = item.nextElementSibling;
            while (nextItem && nextItem.classList.contains('note-item')) {
                const itemPath = nextItem.dataset.path;
                if (!itemPath || !itemPath.startsWith(folderPath + '/')) break;

                if (isCollapsed) {
                    nextItem.classList.add('hidden');
                } else {
                    nextItem.classList.remove('hidden');
                }
                nextItem = nextItem.nextElementSibling;
            }
            return;
        }

        // Handle file click
        if (item.dataset.path && item.dataset.type !== 'folder') {
            loadNote(item.dataset.path);
        }
    });

    notesList.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.note-item');
        if (!item || !item.dataset.path) return;

        e.preventDefault();
        e.stopPropagation();

        // Handle folder context menu
        if (item.classList.contains('folder')) {
            showFolderContextMenu(e, item.dataset.path);
        } else if (item.dataset.type === 'file') {
            showContextMenu(e, item.dataset.path);
        }
    });

    contextMenu.addEventListener('click', async (e) => {
        const action = e.target.closest('.context-menu-item')?.dataset.action;
        if (!action || !contextMenuTarget) return;

        const target = contextMenuTarget; // Store target before hiding menu
        hideContextMenu();

        switch (action) {
            case 'rename':
                await renameNote(target);
                break;
            case 'duplicate':
                await duplicateNote(target);
                break;
            case 'download':
                await downloadNote(target);
                break;
            case 'exportPdf':
                await exportNoteToPdf(target);
                break;
            case 'delete':
                await deleteNote(target);
                break;
        }
    });

    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    newNoteBtn.addEventListener('click', createNote);
    newFolderBtn.addEventListener('click', createFolder);
    saveBtn.addEventListener('click', saveNote);
    deleteBtn.addEventListener('click', () => deleteNote());
    downloadBtn.addEventListener('click', () => downloadNote());
    exportPdfBtn.addEventListener('click', () => exportNoteToPdf());

    // Preview and Markdown mode toggles
    const previewBtn = document.getElementById('previewBtn');
    const markdownBtn = document.getElementById('markdownBtn');
    let isPreviewMode = false;
    let isMarkdownMode = false;

    previewBtn.addEventListener('click', () => {
        isPreviewMode = !isPreviewMode;
        const toolbar = document.querySelector('.ql-toolbar');
        const editor = document.querySelector('.ql-editor');

        if (isPreviewMode) {
            toolbar.style.display = 'none';
            editor.setAttribute('contenteditable', 'false');
            previewBtn.classList.add('active');
        } else {
            toolbar.style.display = 'block';
            editor.setAttribute('contenteditable', 'true');
            previewBtn.classList.remove('active');
        }
    });

    markdownBtn.addEventListener('click', () => {
        isMarkdownMode = !isMarkdownMode;
        const editor = document.querySelector('.ql-editor');

        if (isMarkdownMode) {
            // Show raw HTML/markdown
            const content = quill.root.innerHTML;
            quill.root.textContent = content;
            markdownBtn.classList.add('active');
        } else {
            // Back to rich text
            const content = quill.root.textContent;
            quill.root.innerHTML = content;
            markdownBtn.classList.remove('active');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (currentNote) saveNote();
        }
    });

    // Init
    loadNotes();
});
