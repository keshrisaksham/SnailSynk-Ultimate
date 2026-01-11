// static/js/backbone.js

document.addEventListener('DOMContentLoaded', () => {

    // --- UTILITY FUNCTIONS ---
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, match => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[match]));
    }

    async function fetchQrCode(type, payload = {}) {
        try {
            const response = await fetch('/api/qr_code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, ...payload })
            });
            if (!response.ok) throw new Error('Server returned an error.');
            const result = await response.json();
            if (result.success) {
                return result.svg;
            } else {
                throw new Error(result.error || 'Failed to generate QR code.');
            }
        } catch (error) {
            console.error(`Error fetching ${type} QR code:`, error);
            return '<p style="color:var(--c-error-text); font-size:0.8rem;">Could not load QR code.</p>';
        }
    };

    // --- THEME TOGGLE LOGIC (Shared Header) ---
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // --- ACCENT COLOR PICKER LOGIC ---
    const accentToggle = document.getElementById('accent-toggle');
    const accentPicker = document.getElementById('accent-picker');
    const accentOptions = document.querySelectorAll('.accent-option');

    // Apply saved accent on page load (already done in head, but set active state)
    const savedAccent = localStorage.getItem('accent') || 'red';
    accentOptions.forEach(opt => {
        if (opt.dataset.accent === savedAccent) {
            opt.classList.add('active');
        }
    });

    if (accentToggle && accentPicker) {
        // Toggle picker visibility
        accentToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            accentPicker.classList.toggle('visible');
        });

        // Handle accent selection
        accentOptions.forEach(option => {
            option.addEventListener('click', () => {
                const accent = option.dataset.accent;

                // Remove all accent classes and add the selected one
                document.documentElement.classList.remove(
                    'accent-red', 'accent-blue', 'accent-green',
                    'accent-purple', 'accent-orange', 'accent-black'
                );
                document.documentElement.classList.add(`accent-${accent}`);

                // Update active state
                accentOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');

                // Save to localStorage
                localStorage.setItem('accent', accent);

                // Close picker
                accentPicker.classList.remove('visible');
            });
        });

        // Close picker when clicking outside
        document.addEventListener('click', (e) => {
            if (!accentPicker.contains(e.target) && e.target !== accentToggle) {
                accentPicker.classList.remove('visible');
            }
        });
    }

    // --- FLASH MESSAGE HANDLING (Shared Base Template) ---
    function dismissMessage(messageElement) {
        if (messageElement) {
            messageElement.style.opacity = '0';
            setTimeout(() => messageElement.remove(), 300);
        }
    }

    function handleFlashMessages() {
        document.querySelectorAll('.flash-messages .close-flash').forEach(button => {
            button.addEventListener('click', (event) => {
                dismissMessage(event.target.parentElement);
            });
        });
        document.querySelectorAll('.flash-messages li').forEach(message => {
            setTimeout(() => dismissMessage(message), 5000);
        });
    }
    handleFlashMessages(); // Run on page load

    // --- GLOBAL ESCAPE KEY HANDLER FOR MODALS ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close all visible modals
            document.querySelectorAll('.modal-overlay.visible').forEach(modal => {
                modal.classList.remove('visible');
            });
        }
    });

    // --- CONNECT DEVICE MODAL LOGIC (Shared Header) ---
    const connectModal = document.getElementById('connectModal');
    if (connectModal) {
        const openConnectBtn = document.getElementById('connectBtn');
        const closeConnectBtn = document.getElementById('closeConnectModal');
        const connectViewToggle = document.getElementById('connectViewToggle');
        const ipConnectView = document.getElementById('ipConnectView');
        const wifiConnectView = document.getElementById('wifiConnectView');
        const ipQrContainer = document.getElementById('ipQrContainer');
        const wifiQrForm = document.getElementById('wifiQrForm');

        openConnectBtn.addEventListener('click', async () => {
            connectModal.classList.add('visible');
            ipQrContainer.innerHTML = '<div class="spinner"></div>';
            const svgCode = await fetchQrCode('ip');
            ipQrContainer.innerHTML = svgCode;
        });

        const closeModal = () => connectModal.classList.remove('visible');
        closeConnectBtn.addEventListener('click', closeModal);
        connectModal.addEventListener('click', (e) => {
            if (e.target === connectModal) closeModal();
        });

        connectViewToggle.addEventListener('change', () => {
            const isWifiView = connectViewToggle.checked;
            ipConnectView.classList.toggle('view-hidden', isWifiView);
            wifiConnectView.classList.toggle('view-hidden', !isWifiView);
        });

        wifiQrForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const ssid = document.getElementById('wifiSSID').value;
            const password = document.getElementById('wifiPassword').value;
            const generateWifiQrBtn = document.getElementById('generateWifiQrBtn');
            const wifiQrContainer = document.getElementById('wifiQrContainer');

            generateWifiQrBtn.disabled = true;
            generateWifiQrBtn.textContent = 'Generating...';
            wifiQrContainer.innerHTML = '<div class="spinner"></div>';

            const svgCode = await fetchQrCode('wifi', { ssid, password });
            wifiQrContainer.innerHTML = svgCode;

            generateWifiQrBtn.disabled = false;
            generateWifiQrBtn.textContent = 'Generate QR Code';
        });
    }

    // --- COFFEE/FEEDBACK MODAL LOGIC (Shared Header) ---
    const coffeeModal = document.getElementById('coffeeModal');
    if (coffeeModal) {
        const openCoffeeBtn = document.getElementById('coffeeBtn');
        const closeCoffeeBtn = document.getElementById('closeCoffeeModal');
        const showFeedbackQrBtn = document.getElementById('showFeedbackQrBtn');
        const showSupportQrBtn = document.getElementById('showSupportQrBtn');
        const feedbackQrView = document.getElementById('feedbackQrView');
        const supportQrView = document.getElementById('supportQrView');
        const feedbackQrContainer = document.getElementById('feedbackQrContainer');
        const coffeeQrContainer = document.getElementById('coffeeQrContainer');

        let isFeedbackQrLoaded = false;
        let isSupportQrLoaded = false;

        openCoffeeBtn.addEventListener('click', async () => {
            coffeeModal.classList.add('visible');
            if (!isFeedbackQrLoaded) {
                feedbackQrContainer.innerHTML = '<div class="spinner"></div>';
                const svgCode = await fetchQrCode('instagram');
                feedbackQrContainer.innerHTML = svgCode;
                isFeedbackQrLoaded = true;
            }
        });

        showFeedbackQrBtn.addEventListener('click', () => {
            feedbackQrView.style.display = 'block';
            supportQrView.style.display = 'none';
            showFeedbackQrBtn.classList.add('active');
            showSupportQrBtn.classList.remove('active');
        });

        showSupportQrBtn.addEventListener('click', async () => {
            feedbackQrView.style.display = 'none';
            supportQrView.style.display = 'block';
            showFeedbackQrBtn.classList.remove('active');
            showSupportQrBtn.classList.add('active');

            if (!isSupportQrLoaded) {
                coffeeQrContainer.innerHTML = '<div class="spinner"></div>';
                const svgCode = await fetchQrCode('upi');
                coffeeQrContainer.innerHTML = svgCode;
                isSupportQrLoaded = true;
            }
        });

        const closeCoffeeModal = () => coffeeModal.classList.remove('visible');
        closeCoffeeBtn.addEventListener('click', closeCoffeeModal);
        coffeeModal.addEventListener('click', (e) => {
            if (e.target === coffeeModal) closeCoffeeModal();
        });
    }

    // Expose utility functions to other scripts by attaching them to the window object
    window.AppUtils = {
        escapeHTML
    };
});