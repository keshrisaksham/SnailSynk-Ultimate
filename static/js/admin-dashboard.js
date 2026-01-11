// static/js/admin-dashboard.js - Enhanced Dashboard interactivity

document.addEventListener('DOMContentLoaded', () => {
    // --- Sidebar Toggle (runs on ALL admin pages) ---
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('admin-sidebar');

    if (sidebarToggle && sidebar) {
        // Load saved state from localStorage
        const savedState = localStorage.getItem('admin-sidebar-collapsed');
        if (savedState === 'true') {
            sidebar.classList.add('collapsed');
        }

        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            // Save state to localStorage
            localStorage.setItem('admin-sidebar-collapsed', sidebar.classList.contains('collapsed'));
        });
    }

    // Ensure we're on the monitoring page for the rest of the dashboard logic
    if (!document.getElementById('client-list-body')) return;

    // --- DOM Elements ---
    const clientListBody = document.getElementById('client-list-body');
    const blocklistBody = document.getElementById('blocklist-body');
    const logBody = document.getElementById('log-body');
    const blockIpForm = document.getElementById('block-ip-form');
    const ipInput = document.getElementById('ip-to-block-input');
    const toggleFormBtn = document.querySelector('.toggle-form-btn');
    const clientCountEl = document.getElementById('client-count');
    const blockedCountEl = document.getElementById('blocked-count');
    const totalLogsEl = document.getElementById('total-logs');
    const recentActivityEl = document.getElementById('recent-activity');
    const loadMoreBtn = document.getElementById('load-more-logs-btn');
    const logFooter = document.getElementById('log-footer');
    const clearLogsBtn = document.querySelector('.clear-logs-btn');
    const refreshClientsBtn = document.querySelector('.refresh-clients-btn');
    const logSearchInput = document.getElementById('log-search');
    const activityTimeline = document.getElementById('activity-timeline');

    // --- State ---
    let logOffset = 0;
    const logLimit = 20;
    let allLogs = [];
    let filteredLogs = [];

    // --- Socket.IO Connection (if available) ---
    const initializeSocket = () => {
        if (typeof io !== 'undefined') {
            const socket = io();

            socket.on('connect', () => {
                console.log('Connected to server');
            });

            socket.on('client_update', (data) => {
                loadClients();
            });

            socket.on('blocklist_update', (data) => {
                loadBlocklist();
            });

            socket.on('action_log_update', (data) => {
                loadLogs(true);
                loadStats();
                loadActivityTimeline();
            });

            return socket;
        }
        return null;
    };

    const socket = initializeSocket();

    // --- API Functions ---
    const apiCall = async (endpoint, method = 'GET', body = null) => {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const response = await fetch(`/admin/api/${endpoint}`, options);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            return null;
        }
    };

    // --- Load Functions ---
    const loadClients = async () => {
        const data = await apiCall('clients');
        if (!data || !data.clients) return;

        clientCountEl.textContent = data.clients.length;

        if (data.clients.length === 0) {
            clientListBody.innerHTML = '<tr class="empty-row"><td colspan="3">No connected clients</td></tr>';
            return;
        }

        clientListBody.innerHTML = data.clients
            .map(
                (client) => `
            <tr style="animation: fadeIn 0.3s ease-out;">
                <td><code>${escapeHtml(client.ip)}</code></td>
                <td>${formatDate(client.connected_since)}</td>
                <td style="text-align: right;">
                    <button class="btn-sm btn-danger" onclick="blockClient('${escapeHtml(client.ip)}')" title="Block this IP">
                        Block
                    </button>
                </td>
            </tr>
        `
            )
            .join('');
    };

    const loadBlocklist = async () => {
        const data = await apiCall('blocklist');
        if (!data || !data.blocked_ips) return;

        blockedCountEl.textContent = data.blocked_ips.length;

        if (data.blocked_ips.length === 0) {
            blocklistBody.innerHTML = '<tr class="empty-row"><td colspan="2">No blocked IPs</td></tr>';
            return;
        }

        blocklistBody.innerHTML = data.blocked_ips
            .map(
                (ip) => `
            <tr style="animation: fadeIn 0.3s ease-out;">
                <td><code>${escapeHtml(ip)}</code></td>
                <td style="text-align: right;">
                    <button class="btn-sm btn-danger" onclick="unblockIp('${escapeHtml(ip)}')" title="Unblock this IP">
                        Unblock
                    </button>
                </td>
            </tr>
        `
            )
            .join('');
    };

    const loadStats = async () => {
        const data = await apiCall('stats');
        if (!data || !data.stats) return;

        totalLogsEl.textContent = data.stats.total_logs || 0;
        recentActivityEl.textContent = data.stats.recent_activity || 0;
    };

    const loadLogs = async (reset = false) => {
        if (reset) logOffset = 0;

        const data = await apiCall(`logs?offset=${logOffset}&limit=${logLimit}`);
        if (!data || !data.logs) return;

        if (logOffset === 0) {
            allLogs = data.logs;
            filteredLogs = data.logs;
            logBody.innerHTML = '';
        } else {
            allLogs = [...allLogs, ...data.logs];
            filteredLogs = [...filteredLogs, ...data.logs];
        }

        renderLogs(data.logs);
        logOffset += logLimit;

        // Show load more button if we got a full batch
        logFooter.style.display = data.logs.length === logLimit ? 'flex' : 'none';
    };

    const renderLogs = (logs) => {
        if (logs.length === 0 && logOffset === 0) {
            logBody.innerHTML = '<tr class="empty-row"><td colspan="4">No actions logged yet</td></tr>';
            return;
        }

        const logsHtml = logs
            .map(
                (log) => `
            <tr style="animation: fadeIn 0.3s ease-out;">
                <td><code>${new Date(log.timestamp).toLocaleString('en-US', { timeZone: 'UTC' })}</code></td>
                <td><code>${escapeHtml(log.ip_address || log.ip || 'Unknown')}</code></td>
                <td>${getActionBadge(log.action)}</td>
                <td style="text-align: right; max-width: 200px; overflow: auto;">
                    <code style="font-size: 0.8rem;">${escapeHtml(JSON.stringify(log.details || ''))}</code>
                </td>
            </tr>
        `
            )
            .join('');

        logBody.innerHTML += logsHtml;
    };

    const getActionBadge = (action) => {
        const badges = {
            // Page views
            'PAGE_VIEW': '<span class="badge badge-info">Page View</span>',
            // IP actions
            'IP_BLOCK': '<span class="badge badge-danger">IP Block</span>',
            'IP_UNBLOCK': '<span class="badge badge-success">IP Unblock</span>',
            // AI Chat
            'AI_CHAT': '<span class="badge badge-primary">AI Chat</span>',
            // File operations
            'FILE_UPLOAD': '<span class="badge badge-success">File Upload</span>',
            'FILE_DOWNLOAD': '<span class="badge badge-info">File Download</span>',
            'FILE_DELETE': '<span class="badge badge-danger">File Delete</span>',
            'FILE_LOCK': '<span class="badge badge-warning">File Lock</span>',
            'FILE_UNLOCK': '<span class="badge badge-success">File Unlock</span>',
            'FILE_DOWNLOAD_UNLOCKED': '<span class="badge badge-info">File Unlock & Download</span>',
            'FILE_DOWNLOAD_FAIL': '<span class="badge badge-danger">Download Failed</span>',
            'FILES_DOWNLOAD_ZIP': '<span class="badge badge-info">Zip Download</span>',
            'FILES_LOCK_BATCH': '<span class="badge badge-warning">Batch Lock</span>',
            'FILES_UNLOCK_BATCH': '<span class="badge badge-success">Batch Unlock</span>',
            'FILES_DELETE_BATCH': '<span class="badge badge-danger">Batch Delete</span>',
            // Buffer
            'BUFFER_UPDATE': '<span class="badge badge-primary">Buffer Update</span>',
            // Notes
            'NOTE_SAVE': '<span class="badge badge-primary">Note Save</span>',
            'NOTE_CREATE': '<span class="badge badge-success">Note Create</span>',
            'NOTE_DELETE': '<span class="badge badge-danger">Note Delete</span>',
            'NOTE_RENAME': '<span class="badge badge-warning">Note Rename</span>',
            'NOTE_MOVE': '<span class="badge badge-info">Note Move</span>',
            'NOTE_DOWNLOAD': '<span class="badge badge-info">Note Download</span>',
            'NOTE_DELETE_BATCH': '<span class="badge badge-danger">Notes Batch Delete</span>',
        };
        return badges[action] || `<span class="badge badge-default">${escapeHtml(action)}</span>`;
    };

    const loadActivityTimeline = async () => {
        const data = await apiCall('logs?offset=0&limit=10');
        if (!data || !data.logs || data.logs.length === 0) {
            activityTimeline.innerHTML = `
                <div class="timeline-empty">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p>No recent activity</p>
                </div>
            `;
            return;
        }

        const timelineHtml = data.logs
            .map(
                (log) => `
            <div class="timeline-item" style="animation: fadeIn 0.3s ease-out;">
                <div class="timeline-icon">
                    ${getActionIcon(log.action)}
                </div>
                <div class="timeline-content">
                    <p class="timeline-action">${escapeHtml(log.action.replace(/_/g, ' '))}</p>
                    <p class="timeline-details">IP: <code>${escapeHtml(log.ip_address || log.ip || 'Unknown')}</code></p>
                    <p class="timeline-time">${formatRelativeTime(log.timestamp)}</p>
                </div>
            </div>
        `
            )
            .join('');

        activityTimeline.innerHTML = timelineHtml;
    };

    const getActionIcon = (action) => {
        const icons = {
            // Page views
            'PAGE_VIEW': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
            // IP actions
            'IP_BLOCK': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>',
            'IP_UNBLOCK': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            // AI Chat
            'AI_CHAT': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
            // File operations
            'FILE_UPLOAD': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>',
            'FILE_DOWNLOAD': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            'FILE_DELETE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
            'FILE_LOCK': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
            'FILE_UNLOCK': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>',
            'FILES_DOWNLOAD_ZIP': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            // Buffer
            'BUFFER_UPDATE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
            // Notes
            'NOTE_SAVE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
            'NOTE_CREATE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>',
            'NOTE_DELETE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
            'NOTE_RENAME': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
            'NOTE_MOVE': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>',
            'NOTE_DOWNLOAD': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
        };
        return icons[action] || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    };

    // --- Event Listeners ---
    blockIpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ip = ipInput.value.trim();
        if (!ip) return;

        const success = await apiCall('block_ip', 'POST', { ip });
        if (success) {
            ipInput.value = '';
            await loadBlocklist();
            await loadClients();
            showNotification('IP blocked successfully', 'success');
        }
    });

    if (toggleFormBtn) {
        toggleFormBtn.addEventListener('click', () => {
            blockIpForm.style.display =
                blockIpForm.style.display === 'none' ? 'flex' : 'none';
            toggleFormBtn.classList.toggle('active');
            if (blockIpForm.style.display === 'flex') {
                ipInput.focus();
            }
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            loadLogs(false);
        });
    }

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            if (
                confirm(
                    'Are you sure you want to clear all action logs? This cannot be undone.'
                )
            ) {
                await apiCall('clear_logs', 'POST');
                await loadLogs(true);
                await loadStats();
                await loadActivityTimeline();
                showNotification('Logs cleared successfully', 'info');
            }
        });
    }

    if (refreshClientsBtn) {
        refreshClientsBtn.addEventListener('click', async () => {
            refreshClientsBtn.classList.add('spinning');
            await loadClients();
            setTimeout(() => {
                refreshClientsBtn.classList.remove('spinning');
            }, 1000);
        });
    }

    if (logSearchInput) {
        logSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            if (!searchTerm) {
                filteredLogs = allLogs;
            } else {
                filteredLogs = allLogs.filter(
                    (log) =>
                        log.ip_address.toLowerCase().includes(searchTerm) ||
                        log.action.toLowerCase().includes(searchTerm) ||
                        JSON.stringify(log.details).toLowerCase().includes(searchTerm)
                );
            }
            logBody.innerHTML = '';
            renderLogs(filteredLogs);
        });
    }

    // --- Global Functions (for inline onclick handlers) ---
    window.blockClient = async (ip) => {
        const success = await apiCall('block_ip', 'POST', { ip });
        if (success) {
            await loadClients();
            await loadBlocklist();
            showNotification(`IP ${ip} blocked successfully`, 'success');
        }
    };

    window.unblockIp = async (ip) => {
        if (confirm(`Unblock IP ${ip}?`)) {
            const success = await apiCall('unblock_ip', 'POST', { ip });
            if (success) {
                await loadBlocklist();
                await loadClients();
                showNotification(`IP ${ip} unblocked successfully`, 'success');
            }
        }
    };

    // --- Utility Functions ---
    const formatDate = (dateString) => {
        try {
            if (!dateString) return 'Unknown';
            // Handle ISO format with timezone
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Invalid Date';
            return date.toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (e) {
            console.error('Date parsing error:', e, dateString);
            return dateString || 'Unknown';
        }
    };

    const formatRelativeTime = (dateString) => {
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
            if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            return formatDate(dateString);
        } catch {
            return dateString;
        }
    };

    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const showNotification = (message, type = 'info') => {
        // Simple notification - you can enhance this with a toast library
        console.log(`[${type.toUpperCase()}] ${message}`);
    };

    // --- Charts Initialization ---
    let actionTypesChart = null;
    let activityTimeChart = null;

    const initCharts = async () => {
        // Get all logs for chart data
        const data = await apiCall('logs?offset=0&limit=1000');
        if (!data || !data.logs || data.logs.length === 0) return;

        const logs = data.logs;

        // Get computed colors for dark mode support
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--c-text-main').trim() || '#ffffff';
        const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--c-border').trim() || 'rgba(255, 255, 255, 0.1)';

        // Action Types Distribution
        const actionCounts = {};
        logs.forEach(log => {
            const action = log.action || 'Unknown';
            actionCounts[action] = (actionCounts[action] || 0) + 1;
        });

        const actionTypesEl = document.getElementById('actionTypesChart');
        if (actionTypesEl) {
            if (actionTypesChart) actionTypesChart.destroy();

            const actionLabels = Object.keys(actionCounts).map(key => key.replace(/_/g, ' '));
            const actionValues = Object.values(actionCounts);

            actionTypesChart = new ApexCharts(actionTypesEl, {
                series: actionValues,
                chart: {
                    type: 'donut',
                    height: 220,
                    fontFamily: "'Inter', 'Segoe UI', sans-serif",
                    toolbar: { show: false },
                    animations: {
                        enabled: true,
                        speed: 800
                    }
                },
                labels: actionLabels,
                colors: ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#f472b6', '#818cf8'],
                legend: {
                    position: 'right',
                    fontSize: '13px',
                    fontWeight: 500,
                    labels: {
                        colors: textColor,
                        useSeriesColors: false
                    },
                    markers: {
                        width: 10,
                        height: 10,
                        radius: 10
                    },
                    itemMargin: {
                        horizontal: 5,
                        vertical: 5
                    }
                },
                dataLabels: {
                    enabled: false
                },
                plotOptions: {
                    pie: {
                        donut: {
                            size: '65%',
                            labels: {
                                show: false
                            }
                        }
                    }
                },
                stroke: {
                    width: 2,
                    colors: ['rgba(255, 255, 255, 0.1)']
                },
                tooltip: {
                    theme: 'dark',
                    y: {
                        formatter: function (val) {
                            return val + ' actions'
                        }
                    }
                }
            });
            actionTypesChart.render();
        }

        // Activity Over Time (last 7 days)
        const now = new Date();
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            last7Days.push(date.toISOString().split('T')[0]);
        }

        const dailyCounts = {};
        last7Days.forEach(day => dailyCounts[day] = 0);

        logs.forEach(log => {
            if (log.timestamp) {
                const logDate = new Date(log.timestamp).toISOString().split('T')[0];
                if (dailyCounts.hasOwnProperty(logDate)) {
                    dailyCounts[logDate]++;
                }
            }
        });

        const activityTimeEl = document.getElementById('activityTimeChart');
        if (activityTimeEl) {
            if (activityTimeChart) activityTimeChart.destroy();

            const categories = last7Days.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            const seriesData = Object.values(dailyCounts);

            activityTimeChart = new ApexCharts(activityTimeEl, {
                series: [{
                    name: 'Actions',
                    data: seriesData
                }],
                chart: {
                    type: 'area',
                    height: 220,
                    fontFamily: "'Inter', 'Segoe UI', sans-serif",
                    toolbar: { show: false },
                    zoom: { enabled: false },
                    animations: {
                        enabled: true,
                        speed: 800
                    }
                },
                dataLabels: {
                    enabled: false
                },
                stroke: {
                    curve: 'smooth',
                    width: 3,
                    colors: ['#60a5fa']
                },
                fill: {
                    type: 'gradient',
                    gradient: {
                        shadeIntensity: 1,
                        opacityFrom: 0.5,
                        opacityTo: 0.1,
                        stops: [0, 90, 100]
                    },
                    colors: ['#60a5fa']
                },
                markers: {
                    size: 5,
                    colors: ['#60a5fa'],
                    strokeColors: '#fff',
                    strokeWidth: 2,
                    hover: {
                        size: 7
                    }
                },
                xaxis: {
                    categories: categories,
                    labels: {
                        style: {
                            colors: textColor,
                            fontSize: '12px',
                            fontWeight: 500
                        }
                    },
                    axisBorder: {
                        show: false
                    },
                    axisTicks: {
                        show: false
                    }
                },
                yaxis: {
                    labels: {
                        style: {
                            colors: textColor,
                            fontSize: '12px',
                            fontWeight: 500
                        }
                    }
                },
                grid: {
                    borderColor: borderColor,
                    strokeDashArray: 4,
                    xaxis: {
                        lines: {
                            show: false
                        }
                    },
                    yaxis: {
                        lines: {
                            show: true
                        }
                    }
                },
                tooltip: {
                    theme: 'dark',
                    x: {
                        show: true
                    },
                    y: {
                        formatter: function (val) {
                            return val + ' actions'
                        }
                    }
                }
            });
            activityTimeChart.render();
        }
    };

    // --- Initialize ---
    loadClients();
    loadBlocklist();
    loadStats();
    loadLogs();
    loadActivityTimeline();
    initCharts();

    // Refresh data every 10 seconds
    setInterval(() => {
        loadClients();
        loadBlocklist();
        loadStats();
        loadActivityTimeline();
    }, 10000);
});

// CSS for animations and badges
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.025em;
    }

    .badge-primary {
        background: linear-gradient(135deg, #3b82f6, #60a5fa);
        color: white;
    }

    .badge-success {
        background: linear-gradient(135deg, #10b981, #34d399);
        color: white;
    }

    .badge-danger {
        background: linear-gradient(135deg, #ef4444, #f87171);
        color: white;
    }

    .badge-warning {
        background: linear-gradient(135deg, #f59e0b, #fbbf24);
        color: white;
    }

    .badge-info {
        background: linear-gradient(135deg, #8b5cf6, #a78bfa);
        color: white;
    }

    .badge-default {
        background: var(--c-surface);
        color: var(--c-text-main);
        border: 1px solid var(--c-border);
    }
`;
document.head.appendChild(style);
