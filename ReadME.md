# 🐌 SnailSynk - Ultimate Edition

<p align="center">
  <img src="static/icon/favicon.png" alt="SnailSynk Logo" width="120" />
</p>

<p align="center">
  <strong>A powerful, self-hosted web application for real-time collaboration, file management, and productivity — all on your local network.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.8+-blue?style=flat-square&logo=python" alt="Python 3.8+"/>
  <img src="https://img.shields.io/badge/Flask-WebSocket-green?style=flat-square&logo=flask" alt="Flask"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License"/>
</p>

---

## 🌟 What is SnailSynk?

SnailSynk transforms your local network into a seamless hub for real-time collaboration, advanced file management, and productivity. Built with Python, Flask, and WebSockets, it works **without requiring an internet connection** — perfect for home networks, classrooms, or offline environments.

---

## ✨ Features

### 📋 Real-Time Collaboration

| Feature | Description |
|---------|-------------|
| **Synchronized Text Buffer** | Shared text area with real-time updates across all connected clients. Perfect for code snippets, links, or notes. |
| **Pinned Messages** | Pin up to 5 important messages for quick access and reference. |
| **Markdown Preview** | Toggle markdown preview and full markdown editor mode. |
| **AI Chat Integration** | Chat with Google Gemini AI directly within the app (requires API key). |
| **WebSocket Engine** | All updates (text, files, pins) are instantly reflected without page refresh. |

### 📂 Advanced File Management

| Feature | Description |
|---------|-------------|
| **Drag & Drop Uploads** | Modern upload area with progress bar and cancel support. |
| **Clipboard Paste** | Paste images directly from clipboard to upload. |
| **Image Previews** | Hover over image files to see live previews. |
| **Real-Time File List** | File directory updates instantly for all users when files are uploaded/deleted. |
| **Search & Sort** | Search files by name, sort by name or date (newest/oldest). |
| **Password Protection** | Lock individual files with password protection. |
| **Batch Operations** | Select multiple files to lock, unlock, download as ZIP, or delete. |

### 🎮 Game Arcade

| Game | Description |
|------|-------------|
| **Tic-Tac-Toe** | Classic two-player strategy game. |
| **Snake** | The classic arcade game. |
| **Flappy Bird** | Test your reflexes! |

### 🛡️ Admin Dashboard

| Feature | Description |
|---------|-------------|
| **Live Client Monitoring** | See all connected devices in real-time with IP addresses and connection time. |
| **Activity Timeline** | View recent actions (uploads, downloads, buffer updates). |
| **Activity Graphs** | Visual charts showing action distribution and activity over time. |
| **IP Access Control** | Block/unblock specific IP addresses from accessing the app. |
| **Action Logs** | Searchable log of all user actions. |

### 📝 Notes Editor (Admin Only)

| Feature | Description |
|---------|-------------|
| **WYSIWYG Editor** | Rich-text editing with Quill.js. |
| **File & Folder System** | Hierarchical organization with drag-and-drop. |
| **Context Menu** | Right-click for rename, duplicate, download, delete. |
| **Batch Actions** | Select multiple notes to download or delete. |
| **Markdown Export** | Notes export as `.md` files. |

### 📱 Mobile Responsive

- Fully responsive design optimized for phones and tablets
- Touch-friendly buttons and navigation
- Bottom navigation bar on mobile admin pages
- Scrollable panels and stacked layouts

### 🔗 Connectivity Features

| Feature | Description |
|---------|-------------|
| **Dynamic QR Codes** | Generate QR codes to share the app URL or WiFi credentials. |
| **Theme Toggle** | Light/Dark mode with smooth transitions. |
| **Accent Color Picker** | Customize the app's accent color. |

---

## 💻 Technology Stack

| Category | Technologies |
|----------|-------------|
| **Backend** | Python 3.8+, Flask, Flask-SocketIO, Gevent |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| **Real-Time** | Socket.IO, WebSockets |
| **Editor** | Quill.js (Notes), EasyMDE (Buffer) |
| **AI** | Google Generative AI (Gemini) |
| **Security** | Argon2 password hashing, session management |
| **Utilities** | python-dotenv, pyperclip, qrcode, rich |

---

## 🚀 Getting Started

### Prerequisites

- **Git** (to clone the repository)
- **Python 3.8+** with pip

### Quick Installation

#### Windows

```batch
# Clone the repository
git clone https://github.com/YawnByte/SnailSynk-Ultimate-NG.git
cd SnailSynk-Ultimate-NG

# Run the installer
Snail.bat
```

The batch file will:
1. Install all Python dependencies
2. Prompt for admin username and password
3. Prompt for Gemini API key (optional, for AI chat)
4. Prompt for port number (default: 9000)
5. Create a desktop shortcut
6. Start the application

#### Linux/macOS

```bash
# Clone the repository
git clone https://github.com/YawnByte/SnailSynk-Ultimate-NG.git
cd SnailSynk-Ultimate-NG

# Make the script executable and run
chmod +x Snail.sh
./Snail.sh
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/YawnByte/SnailSynk-Ultimate-NG.git
cd SnailSynk-Ultimate-NG

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # Linux/macOS
# or
.\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Create .env file with your configuration
echo "FLASK_SECRET_KEY=your-secret-key-here" > .env
echo "SNAILSYNK_PORT=9000" >> .env
echo "GEMINI_API_KEY=your-api-key-here" >> .env  # Optional

# Run the application
python SnailSynk.py
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FLASK_SECRET_KEY` | Flask session secret key | Auto-generated |
| `SNAILSYNK_PORT` | Port to run the server on | `9000` |
| `GEMINI_API_KEY` | Google Gemini API key for AI chat | None (optional) |

### First-Time Setup

On first run, you'll be prompted to create an admin account. These credentials are stored securely using Argon2 password hashing.

---

## 🌐 Usage

Once the server is running, your terminal will display two access URLs:

1. **From the host computer:**
   ```
   http://localhost:9000
   ```

2. **From other devices on the same network:**
   ```
   http://<your-ip>:9000
   ```
   Example: `http://192.168.1.100:9000`

### Accessing Admin Features

1. Click **"Admin?"** in the header
2. Enter your admin credentials
3. Access the Dashboard, Monitoring, and Notes Editor

---

## 📁 Project Structure

```
SnailSynk-Ultimate-NG/
├── backbone/              # Core managers (files, content, users, notes)
├── routes/                # Flask blueprints (index, admin, AI chat)
├── static/
│   ├── css/              # Stylesheets (common, mobile, admin)
│   ├── js/               # JavaScript (index, admin, notes)
│   └── icon/             # Icons and images
├── templates/
│   ├── admin/            # Admin templates (dashboard, notes, login)
│   └── *.html            # Index templates
├── SnailSynk.py          # Main application entry point
├── Snail.bat             # Windows installer/launcher
├── Snail.sh              # Linux/macOS installer/launcher
├── requirements.txt      # Python dependencies
└── README.md             # This file
```

---

## 🔒 Security Features

- **Password Protection**: Lock individual files with secure passwords
- **Argon2 Hashing**: Admin passwords are securely hashed
- **Session Management**: Secure Flask sessions with expiration
- **IP Blocking**: Block malicious IPs from accessing the app
- **Path Sanitization**: Prevents directory traversal attacks

---

## 📝 File Storage

Files are stored in:
- **Windows:** `C:\Users\<username>\Downloads\SnailSynk\files\`
- **Linux/macOS:** `~/Downloads/SnailSynk/files/`

Notes are stored in:
- **Windows:** `C:\Users\<username>\Downloads\SnailSynk\notes\`
- **Linux/macOS:** `~/Downloads/SnailSynk/notes/`

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

## 📄 License

This project is licensed under the MIT License.

---

## 👤 Author

**YawnByte** (Saksham)

- GitHub: [@YawnByte](https://github.com/YawnByte)
- Instagram: [@Sometimes.Saksham](https://www.instagram.com/Sometimes.Saksham/)

---

<p align="center">
  Made with ❤️ and ☕
</p>