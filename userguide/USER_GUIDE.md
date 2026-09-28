# ESMS - User & Administrator Guide

Welcome to the **ESMS (Electronic Store Management System)** User & Administration Guide. This folder contains all the technical and operational documentation for running, maintaining, and scaling the system.

---

## 📑 Table of Contents

1. [Quick Start & Default Credentials](#1-quick-start--default-credentials)
2. [Multi-User Architecture & Centralized Database](#2-multi-user-architecture--centralized-database)
3. [Data Management, Backups & Migration Tools](#3-data-management-backups--migration-tools)
4. [Local Network (LAN) Multi-PC Setup](#4-local-network-lan-multi-pc-setup)
5. [Online Cloud Database Multi-PC Setup](#5-online-cloud-database-multi-pc-setup)
6. [Building the Desktop Installer (.exe)](#6-building-the-desktop-installer-exe)
7. [Troubleshooting & FAQs](#7-troubleshooting--faqs)

---

## 1. Quick Start & Default Credentials

### Running the Application (Development)
```bash
npm start
```
*(or `npm run dev`)*

### Default Admin Login
* **Username:** `admin`
* **Password:** `admin123`
* **Recovery Code:** `123456`

### Default MySQL Database Credentials
* **Host:** `localhost`
* **Port:** `3306`
* **User:** `root`
* **Password:** `afras7988`
* **Database Name:** `fridge_agency`

---

## 2. Multi-User Architecture & Centralized Database

The application connects directly to a centralized **MySQL Server** using connection pooling:

```
[🖥️ PC 1: Cash Counter] ───┐
                            ├───► [☁️ Central MySQL Database: fridge_agency]
[🖥️ PC 2: Main Office]  ───┘
```

* **Instant Updates:** Any product added, sale made, or installment recorded on one computer is immediately visible to all other connected computers.
* **Concurrency & Stock Safety:** Inventory deductions are wrapped in atomic database transactions (`withTransaction`), preventing stock overselling if two users check out the same product simultaneously.
* **Centralized Photos:** Customer and profile photos are saved as Base64 strings directly in MySQL (`LONGTEXT`), ensuring all connected computers can view photos without needing a shared Windows network folder.

---

## 3. Google Drive & Cloud Backup Management

Navigate to **Settings $\rightarrow$ Google Drive & Cloud Backups** to manage automated and on-demand cloud backups.

### ☁️ How to Sync Backups Automatically to Google Drive
1. Install the free **[Google Drive for Desktop](https://www.google.com/drive/download/)** app on your main host computer.
2. Sign in with your Google account (this creates a virtual Google Drive on your computer, e.g., `G:\My Drive\` or `C:\Users\YourName\Google Drive\`).
3. In ESMS under **Settings $\rightarrow$ Google Drive & Cloud Backups**, either click **"Browse..."** or **paste your folder path directly** into the box and click **"Save Path"**:
   ```
   G:\My Drive\ESMS_Backups
   ```
4. Now, every automatic daily backup and manual backup created by ESMS will **instantly sync to your Google Drive cloud account**. You can view or download your backups from anywhere in the world at [drive.google.com](https://drive.google.com).

### 🛠️ Available Backup Features:
* **🇵🇰 Pakistani Timezone (PKT) Timestamps:** All backup files and folders are saved with precise Pakistani Standard Time (UTC+5) timestamps matching your clock and Google Drive (e.g. `esms_backup_2026-09-28_10-10-06-PM.json`).
* **📋 Direct Folder Pasting & Manual Entry:** You can type or paste any folder path directly (including Google Drive, OneDrive, or network paths) and click **"Save Path"** (folders will be auto-created if they do not exist yet).
* **🟢 Backup Now to Drive:** Takes an instant snapshot of all database tables and saves it to your cloud sync folder.
* **⚙️ When is Auto-Backup Taken?**
  1. **On Application Launch:** Automatically creates a backup snapshot 3 seconds after the app opens (once per day, based on Pakistan date).
  2. **Periodic Background Checks:** If the application stays open continuously, it checks every 4 hours and creates the daily backup if not already created.
  3. **On Demand:** Any time you click **"Backup Now to Drive"**.
* **🛡️ Retention Pruning (Keep Last X Days):** Automatically deletes backups older than 30 days (customizable) to prevent filling up storage.
* **🕒 Recent Backups List & 1-Click Restore:** Displays a table of all existing backups in your folder with file size and Pakistani creation date/time, allowing you to restore the database with one click.
* **🟡 Export File / Import File:** Manually export or import standalone `.json` database snapshots to/from any location.
* **🔵 Migrate from SQLite (.db):** 1-click import tool to transfer historical records from legacy `esms.db` files.

---

## 4. Local Network (LAN) Multi-PC Setup

To connect multiple computers in the same store or office over Wi-Fi / LAN:

### Step 1: On the Host PC (Where MySQL is installed)
1. Find the Host PC's IP address:
   * Open Command Prompt, run `ipconfig`, and note the IPv4 address (e.g., `192.168.1.50`).
2. Allow MySQL port `3306` in Windows Defender Firewall:
   * Open **Windows Defender Firewall with Advanced Security** $\rightarrow$ **Inbound Rules** $\rightarrow$ **New Rule** $\rightarrow$ **Port** $\rightarrow$ **TCP 3306** $\rightarrow$ **Allow the connection**.
3. Grant remote access to the MySQL user (in MySQL Workbench):
   ```sql
   CREATE USER 'root'@'%' IDENTIFIED BY 'afras7988';
   GRANT ALL PRIVILEGES ON fridge_agency.* TO 'root'@'%';
   FLUSH PRIVILEGES;
   ```

### Step 2: On Client PCs
1. Install and open the ESMS application.
2. Go to **Settings $\rightarrow$ MySQL Centralized Database Settings**.
3. Set **Server Host / IP** to the Host PC's IP (e.g. `192.168.1.50`).
4. Click **Test Connection** (green success message appears) $\rightarrow$ Click **Save & Connect**.

---

## 5. Online Cloud Database Multi-PC Setup

To connect computers across different branches or locations over the Internet:

1. **Host a MySQL Database Online:** Use a cloud provider (e.g., Hostinger VPS, Aiven.io, DigitalOcean, AWS RDS, or cPanel Remote MySQL).
2. **Export Local Data:** In local ESMS, click **Export Backup (JSON)**.
3. **Connect to the Cloud Database:**
   * In **Settings $\rightarrow$ MySQL Centralized Database Settings**, enter your Cloud Host / IP, Port, Username, Password, and Database Name.
   * Click **Test Connection** $\rightarrow$ **Save & Connect**.
4. **Import Data:** Click **Import Backup** and select your exported `.json` file.
5. **Set Up Client PCs:** Install the ESMS app on other computers and enter the same cloud database credentials.

---

## 6. Building the Desktop Installer (.exe)

To generate the standalone Windows installer for distribution:

```bash
npm run build
```

The installer executable will be created in the `dist/` directory:
```
dist/ESMS Setup 1.0.0.exe
```

---

## 7. Troubleshooting & FAQs

* **"Database connection failed" on app launch:**
  * Verify the MySQL service (`MySQL80`) is running in Windows Services (`services.msc`).
  * Check that your firewall allows port `3306`.
* **Where are client settings saved?**
  * Client settings are stored per-machine in `%APPDATA%\ESMS\db_config.json`.
* **Forgot Admin Password:**
  * Click **"Forgot Password?"** on the login screen and enter the default recovery code: `123456`.
