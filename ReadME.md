# 🐌 SnailSynk - Ultimate Edition

SnailSynk is a powerful, self-hosted web application that transforms your local network into a seamless hub for real-time collaboration, advanced file management, and even a bit of fun. Built with Python, Flask, and WebSockets, it's designed to be the ultimate productivity and utility suite for all your devices, no internet connection required.

***
## ✨ Key Features

SnailSynk is more than just a file-sharing tool; it's a comprehensive suite of integrated utilities designed for a modern workflow.

### 📋 Real-Time Collaboration

* **Synchronized Text Buffer:** A shared text area where content updates in real-time across all connected clients. Perfect for sharing code snippets, links, or notes.
* **Pinned Messages:** Pin important text from the buffer for quick access and reference.
* **Real-Time WebSocket Engine:** The core of the app, ensuring all updates—from text changes to new file uploads—are reflected instantly without ever needing to refresh the page.
<br>
### 📂 Advanced File Management

* **Drag & Drop Uploads:** A modern, intuitive upload area with a progress bar. You can even paste an image from your clipboard to prepare it for upload.
* **In-Browser Previews:** Preview images directly in the browser. Previews are automatically disabled for password-protected files.
* **Dynamic File Directory:** Instantly search and sort your shared files by name or modification date. The list updates in real-time as other users upload files.
* **Powerful Admin Controls:**
\*   Password-protect individual files.
\*   Perform bulk actions: lock, unlock, and delete multiple files at once with intuitive checkbox selection.

### 🛡️ Admin Dashboard & Notes Editor

* **Live Client Monitoring:** See a list of all devices currently connected to SnailSynk.
* **IP Access Control:** Block and unblock specific IP addresses from accessing the application.
* **Full-Featured Notes Editor:** A private, admin-only notes sanctuary with a desktop-grade experience:

\*   **WYSIWYG Markdown Editor:** A beautiful and intuitive editor that defaults to a rich-text view.

\*   **File & Folder System:** Organize your notes in a hierarchical file tree.

\*   **Drag & Drop Management:** Effortlessly move files and folders to reorganize your notes.

\*   **Right-Click Context Menu:** Access all essential actions like rename, delete, and download.

\*   **Multi-Select & Batch Actions:** Use checkboxes to select multiple items to download or delete at once.

### 📱 Seamless Connectivity & UX

* **QR Code Sharing:** Instantly generate a QR code to allow mobile devices to connect to SnailSynk or your local Wi-Fi network.
<br>
***

# 💻 Technology Stack

* **Backend:** Python 3, Flask, Flask-SocketIO
* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
* **Real-Time Engine:** Socket.IO
* **Editor:** Toast UI Editor
* **Dependencies:** Pyperclip, Argon2, python-dotenv, Werkzeug

***

# 🚀 Getting Started

Follow these steps to get SnailSynk running on your local machine.

### Prerequisites

* **Git:** To clone the repository.
* **Python 3.8+** and **pip** installed on your system.

### Installation & Setup

**Step 1: Clone the Repository**

```
git clone https://github.com/keshrisaksham/SnailSynk-Ultimate.git 
```
**Step 2: "THE" Installation**

Change Directory :
```bash
cd SnailSynk-Ultimate
```
Locate the Snail.bat file and **run it.**

The .bat file would automatically create a desktop shortcut, install the dependencies ask you once to put the Admin details ( username and password that you want to set for the administrator user) and do all the boring things for you, later you'll just have to click on the SnailSynk shortcut to run it (or you can run it using the SnailSynk.py file in-case you do not like desktop shortcuts (like me)).

**Step 3: Run the Application**

It doesn't run, c'mon it is a computer based software! duh!
***

## 🌐 How to Use

Once the server is running, your terminal will display two access points:

1. **From the host computer:** Open a web browser and navigate to `http://localhost:portnumer`
2. **From other devices (phone, tablet, laptop):** Make sure they are on the **same Wi-Fi network**, then open a browser and navigate to the IP address shown in the terminal (e.g., `http://192.168.1.1:0000`).
