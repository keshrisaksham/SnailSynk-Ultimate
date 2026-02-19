# 🐌 SnailSynk — Ultimate Edition

SnailSynk is a powerful, self-hosted web application that transforms your local network into a seamless hub for real-time collaboration, advanced file management, AI-powered coding assistance, and more. Built with Python, Flask, and WebSockets — no internet connection required.

***

## ✨ Key Features

SnailSynk is more than just a file-sharing tool; it's a comprehensive suite of integrated utilities designed for a modern workflow.

### 📋 Real-Time Collaboration

* **Synchronized Text Buffer:** A shared text area where content updates in real-time across all connected clients. Perfect for sharing code snippets, links, or notes.
* **Pinned Messages:** Pin important text from the buffer for quick access and reference.
* **Share Links:** Generate shareable links for individual files and batch file collections, complete with expiry and access controls.
* **Real-Time WebSocket Engine:** The core of the app, ensuring all updates — from text changes to new file uploads — are reflected instantly without ever needing to refresh.

### 📂 Advanced File Management

* **Drag & Drop Uploads:** A modern, intuitive upload area with a progress bar. Paste images directly from your clipboard to prepare for upload.
* **Folder System:** Organize files into folders with breadcrumb navigation, creating a hierarchical structure for your shared content.
* **Upload to Folders:** Upload files directly into specific folders — no file shuffling needed.
* **In-Browser Previews:** Preview images directly in the browser. Previews are auto-disabled for password-protected files.
* **Dynamic File Directory:** Instantly search and sort your shared files by name or modification date. The list updates in real-time as other users upload files.
* **Powerful Admin Controls:**
  * Password-protect individual files.
  * Lock folders to prevent unauthorized modifications.
  * Perform bulk actions: lock, unlock, and delete multiple files at once with intuitive checkbox selection.

### 🤖 BugByte AI Chat

* **AI-Powered Coding Companion:** A full-featured chat interface powered by Google Gemini for coding assistance, debugging, and explanations.
* **Streaming Responses:** AI responses stream in real-time with a live typing cursor.
* **Markdown & Code Rendering:** Responses render with full Markdown, syntax-highlighted code blocks, and KaTeX math expressions.
* **Conversation History:** Admin users can save, search, rename, and manage conversation history.
* **Fun Bug Theme:** Animated bug-themed loading messages and a funky welcome screen with floating particles.

### 🛡️ Admin Dashboard & Notes Editor

* **Live Client Monitoring:** See all devices currently connected to SnailSynk.
* **IP Access Control:** Block and unblock specific IP addresses from accessing the application.
* **Full-Featured Notes Editor:** A private, admin-only notes sanctuary with a desktop-grade experience:
  * **WYSIWYG Markdown Editor:** A beautiful and intuitive editor that defaults to a rich-text view.
  * **File & Folder System:** Organize your notes in a hierarchical file tree.
  * **Drag & Drop Management:** Effortlessly move files and folders to reorganize your notes.
  * **Right-Click Context Menu:** Access all essential actions like rename, delete, and download.
  * **Multi-Select & Batch Actions:** Use checkboxes to select multiple items to download or delete at once.

### 🎨 Theming & Customization

* **Dark / Light Mode:** Toggle between themes with a single click. Preference is saved locally.
* **Accent Color Picker:** Choose your own accent color to personalize the entire interface — every page respects your choice.

### 📱 Seamless Connectivity & UX

* **QR Code Sharing:** Instantly generate a QR code to allow mobile devices to connect to SnailSynk or your local Wi-Fi network.
* **HTTPS Support:** Self-signed certificate support with automatic HTTP → HTTPS redirection.
* **Responsive Design:** A fully optimized mobile UI with touch-friendly stacked sections, swipe gestures, and a mobile-first layout.

***

## 💻 Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Python 3, Flask, Flask-SocketIO |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| **Real-Time** | Socket.IO |
| **AI** | Google Generative AI (Gemini) |
| **Editor** | Toast UI Editor |
| **Security** | Argon2, Self-Signed TLS |
| **Dependencies** | Pyperclip, python-dotenv, Werkzeug |

***

## 🚀 Getting Started

Follow these steps to get SnailSynk running on your local machine.

### Prerequisites

* **Git:** To clone the repository.
* **Python 3.8+** and **pip** installed on your system.
* **(Optional)** A [Google Gemini API key](https://aistudio.google.com/apikey) for BugByte AI Chat.

### Installation & Setup

**Step 1: Clone the Repository**

```bash
git clone https://github.com/keshrisaksham/SnailSynk-Ultimate.git
```

**Step 2: "THE" Installation**

```bash
cd SnailSynk-Ultimate
```

Locate the `Snail.bat` file and **run it.**

The `.bat` file will automatically create a desktop shortcut, install the dependencies, ask you to set up Admin credentials (username and password), and handle all the boring stuff. After that, just click the **SnailSynk** shortcut to run it (or run `SnailSynk.py` directly if you're not a shortcut person).

**Step 3: (Optional) Configure BugByte AI**

Create a `.env` file in the project root and add your Gemini API key:

```
GEMINI_API_KEY=your_api_key_here
```

**Step 4: Run the Application**

It doesn't *run*, c'mon it is a computer-based software! duh!

***

## 🌐 How to Use

Once the server is running, your terminal will display two access points:

1. **From the host computer:** Open a web browser and navigate to `https://localhost:portnumber`
2. **From other devices (phone, tablet, laptop):** Make sure they are on the **same Wi-Fi network**, then open a browser and navigate to the IP address shown in the terminal (e.g., `https://192.168.1.1:0000`).

***

## ☕ Buy Me a Coffee

If SnailSynk has made your workflow smoother or saved you some time, consider supporting the project! Every contribution motivates further development and new features.

<p align="center">
  <a href="https://upi.link/payment?pa=kumarsaksham@yesg&pn=Saksham&cu=INR">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-UPI-orange?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white" alt="Buy Me a Coffee via UPI" />
  </a>
</p>

**UPI ID:** `kumarsaksham@yesg`

> Built with ❤️ by [YawnByte](https://github.com/keshrisaksham)
