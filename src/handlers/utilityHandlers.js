const fs = require('fs');
const path = require('path');
const { migrateSqliteToMysql } = require('../../scripts/migrate_sqlite_to_mysql');

function getBackupConfigPath(app) {
    try {
        if (app && app.getPath) {
            return path.join(app.getPath('userData'), 'backup_config.json');
        }
    } catch (e) { }
    return path.join(__dirname, '..', '..', 'backup_config.json');
}

function getDefaultBackupFolder(app) {
    try {
        if (app && app.getPath) {
            return path.join(app.getPath('userData'), 'backups');
        }
    } catch (e) { }
    return path.join(__dirname, '..', '..', 'backups');
}

function getBackupSettings(app) {
    const configPath = getBackupConfigPath(app);
    const defaultFolder = getDefaultBackupFolder(app);
    const defaultSettings = {
        backupFolder: defaultFolder,
        autoBackupEnabled: true,
        maxBackupsToKeep: 30,
        lastBackupDate: null
    };

    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            return { ...defaultSettings, ...JSON.parse(data) };
        } catch (e) {
            console.error('Error reading backup_config.json:', e.message);
        }
    }
    return defaultSettings;
}

function saveBackupSettings(app, newSettings) {
    const configPath = getBackupConfigPath(app);
    try {
        const current = getBackupSettings(app);
        const toSave = { ...current, ...newSettings };
        fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
        return { success: true, settings: toSave };
    } catch (e) {
        console.error('Error saving backup_config.json:', e.message);
        return { success: false, message: e.message };
    }
}

function getPakistanTimestamp(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    const map = {};
    for (const p of formatter.formatToParts(date)) {
        map[p.type] = p.value;
    }
    const period = (map.dayPeriod || 'PM').toUpperCase();
    return `${map.year}-${map.month}-${map.day}_${map.hour}-${map.minute}-${map.second}-${period}`;
}

function getPakistanDateOnly(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const map = {};
    for (const p of formatter.formatToParts(date)) {
        map[p.type] = p.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
}

function getPakistanReadableDateTime(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-PK', {
            timeZone: 'Asia/Karachi',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }).format(new Date(date)) + ' (PKT)';
    } catch (e) {
        return new Date(date).toLocaleString() + ' (PKT)';
    }
}

async function executeBackup(dbModule, app, customFolder = null) {
    const settings = getBackupSettings(app);
    let targetFolder = customFolder || settings.backupFolder || getDefaultBackupFolder(app);
    targetFolder = targetFolder.trim().replace(/^["']|["']$/g, '');

    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
    }

    const [admin, products, customers, sales, sale_items, installments, installment_payments, activity_logs] = await Promise.all([
        dbModule.dbAll('SELECT * FROM admin'),
        dbModule.dbAll('SELECT * FROM products'),
        dbModule.dbAll('SELECT * FROM customers'),
        dbModule.dbAll('SELECT * FROM sales'),
        dbModule.dbAll('SELECT * FROM sale_items'),
        dbModule.dbAll('SELECT * FROM installments'),
        dbModule.dbAll('SELECT * FROM installment_payments'),
        dbModule.dbAll('SELECT * FROM activity_logs')
    ]);

    const pktTimestamp = getPakistanTimestamp();
    const fileName = `esms_backup_${pktTimestamp}.json`;
    const filePath = path.join(targetFolder, fileName);
    const readablePkt = getPakistanReadableDateTime();

    const backupData = {
        exportDateUtc: new Date().toISOString(),
        exportDatePakistan: readablePkt,
        database: 'fridge_agency',
        version: '2.0.0',
        data: {
            admin,
            products,
            customers,
            sales,
            sale_items,
            installments,
            installment_payments,
            activity_logs
        }
    };

    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');

    // Update last backup date in settings with PKT timestamp
    saveBackupSettings(app, {
        lastBackupDate: new Date().toISOString(),
        lastBackupPakistanTime: readablePkt
    });

    // Prune old backups exceeding retention limit
    try {
        const maxKeep = settings.maxBackupsToKeep || 30;
        const files = fs.readdirSync(targetFolder)
            .filter(f => f.startsWith('esms_backup_') && f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(targetFolder, f),
                time: fs.statSync(path.join(targetFolder, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > maxKeep) {
            const toDelete = files.slice(maxKeep);
            for (const f of toDelete) {
                try { fs.unlinkSync(f.path); } catch (_) { }
            }
        }
    } catch (e) {
        console.error('Backup retention pruning error:', e.message);
    }

    const stats = fs.statSync(filePath);
    return {
        success: true,
        fileName,
        filePath,
        timestamp: readablePkt,
        sizeBytes: stats.size,
        message: `Backup created successfully in Pakistani Timezone at ${filePath}`
    };
}

async function restoreFromData(dbModule, data) {
    const pool = dbModule.getPool();

    // Restore products
    if (data.products && data.products.length > 0) {
        for (const p of data.products) {
            await pool.query(
                `INSERT INTO products (product_id, name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period, date_added, last_updated)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), brand = VALUES(brand),
                 purchase_price = VALUES(purchase_price), selling_price = VALUES(selling_price), stock_qty = VALUES(stock_qty),
                 min_stock_level = VALUES(min_stock_level), supplier_name = VALUES(supplier_name), warranty_period = VALUES(warranty_period)`,
                [p.product_id, p.name, p.category, p.brand, p.purchase_price, p.selling_price, p.stock_qty, p.min_stock_level, p.supplier_name, p.warranty_period, p.date_added, p.last_updated || p.date_added]
            );
        }
    }

    // Restore customers
    if (data.customers && data.customers.length > 0) {
        for (const c of data.customers) {
            await pool.query(
                `INSERT INTO customers (customer_id, full_name, phone, address, id_number, email, image_path, date_added, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone = VALUES(phone), address = VALUES(address),
                 id_number = VALUES(id_number), email = VALUES(email), image_path = VALUES(image_path), is_deleted = VALUES(is_deleted)`,
                [c.customer_id, c.full_name, c.phone, c.address, c.id_number, c.email, c.image_path, c.date_added, c.is_deleted || 0]
            );
        }
    }

    // Restore sales
    if (data.sales && data.sales.length > 0) {
        for (const s of data.sales) {
            await pool.query(
                `INSERT INTO sales (sale_id, customer_id, walkin_name, walkin_id, sale_date, total_amount, payment_type, status, is_hidden, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), status = VALUES(status), is_hidden = VALUES(is_hidden), is_deleted = VALUES(is_deleted)`,
                [s.sale_id, s.customer_id, s.walkin_name, s.walkin_id, s.sale_date, s.total_amount, s.payment_type, s.status || 'Completed', s.is_hidden || 0, s.is_deleted || 0]
            );
        }
    }

    // Restore sale_items
    if (data.sale_items && data.sale_items.length > 0) {
        for (const si of data.sale_items) {
            await pool.query(
                `INSERT INTO sale_items (sale_item_id, sale_id, product_id, product_name, quantity, unit_price, subtotal, purchase_price, returned_qty)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit_price = VALUES(unit_price), subtotal = VALUES(subtotal), purchase_price = VALUES(purchase_price), returned_qty = VALUES(returned_qty)`,
                [si.sale_item_id, si.sale_id, si.product_id, si.product_name, si.quantity, si.unit_price, si.subtotal, si.purchase_price || 0, si.returned_qty || 0]
            );
        }
    }

    // Restore installments
    if (data.installments && data.installments.length > 0) {
        for (const inst of data.installments) {
            await pool.query(
                `INSERT INTO installments (installment_id, sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date, status, created_at, guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE remaining_balance = VALUES(remaining_balance), status = VALUES(status), next_due_date = VALUES(next_due_date), is_deleted = VALUES(is_deleted)`,
                [inst.installment_id, inst.sale_id, inst.down_payment || 0, inst.total_amount, inst.remaining_balance, inst.monthly_amount, inst.installment_duration, inst.next_due_date, inst.status || 'Active', inst.created_at, inst.guarantor_name, inst.guarantor_cnic, inst.guarantor_mobile, inst.guarantor_address, inst.is_deleted || 0]
            );
        }
    }

    // Restore installment payments
    if (data.installment_payments && data.installment_payments.length > 0) {
        for (const p of data.installment_payments) {
            await pool.query(
                `INSERT INTO installment_payments (payment_id, installment_id, payment_date, amount_paid, payment_method, remaining_balance_after)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE amount_paid = VALUES(amount_paid), payment_method = VALUES(payment_method), remaining_balance_after = VALUES(remaining_balance_after)`,
                [p.payment_id, p.installment_id, p.payment_date, p.amount_paid, p.payment_method || 'Cash', p.remaining_balance_after]
            );
        }
    }

    // Restore admin
    if (data.admin && data.admin.length > 0) {
        for (const a of data.admin) {
            await pool.query(
                `INSERT INTO admin (admin_id, username, password, created_at, profile_image, recovery_code)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE password = VALUES(password), profile_image = VALUES(profile_image), recovery_code = VALUES(recovery_code)`,
                [a.admin_id, a.username, a.password, a.created_at, a.profile_image, a.recovery_code]
            );
        }
    }
}

function registerUtilityHandlers(context) {
    const { ipcMain, dbModule, log, app, dialog } = context;

    ipcMain.handle('log', (event, level, message) => {
        if (log && log[level]) {
            log[level](`[Renderer] ${message}`);
        } else if (log && log.info) {
            log.info(`[Renderer] ${message}`);
        } else {
            console.log(`[Renderer] ${message}`);
        }
    });

    ipcMain.handle('clear-activity-logs', async () => {
        try {
            await dbModule.dbRun('DELETE FROM activity_logs');
            await dbModule.logActivity('admin', 'Clear Logs', 'Cleared all activity logs');
            return { success: true };
        } catch (err) {
            if (log) log.error('Error clearing activity logs:', err);
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-activity-logs', async (event, limit = 100) => {
        try {
            const numLimit = parseInt(limit, 10) || 100;
            const rows = await dbModule.dbAll('SELECT * FROM activity_logs ORDER BY log_id DESC LIMIT ?', [numLimit]);
            return { success: true, logs: rows };
        } catch (err) {
            if (log) log.error('Error fetching activity logs:', err);
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-categories', async () => {
        try {
            const rows = await dbModule.dbAll('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category');
            return { success: true, categories: rows.map(r => r.category) };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-brands', async () => {
        try {
            const rows = await dbModule.dbAll('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != "" ORDER BY brand');
            return { success: true, brands: rows.map(r => r.brand) };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    // Database Connection Configuration IPC
    ipcMain.handle('get-db-config', async () => {
        try {
            const config = dbModule.getDbConfig();
            return { success: true, config };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('test-db-connection', async (event, config) => {
        try {
            const result = await dbModule.testConnection(config);
            return result;
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('save-db-config', async (event, config) => {
        try {
            const saveRes = dbModule.saveDbConfig(config);
            if (!saveRes.success) {
                return saveRes;
            }
            await dbModule.initializeDatabase();
            return { success: true, message: 'Database settings saved and connection established!' };
        } catch (err) {
            return { success: false, message: 'Saved settings, but connection failed: ' + err.message };
        }
    });

    // Backup Settings IPC
    ipcMain.handle('get-backup-settings', async () => {
        try {
            const settings = getBackupSettings(app);
            return { success: true, settings };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('save-backup-settings', async (event, newSettings) => {
        try {
            if (newSettings && newSettings.backupFolder) {
                let folder = newSettings.backupFolder.trim();
                // Strip surrounding quotes if pasted like "C:\Backups" or 'C:\Backups'
                folder = folder.replace(/^["']|["']$/g, '').trim();
                if (folder) {
                    if (!fs.existsSync(folder)) {
                        try {
                            fs.mkdirSync(folder, { recursive: true });
                        } catch (mkdirErr) {
                            return { success: false, message: `Cannot create or access folder "${folder}": ${mkdirErr.message}` };
                        }
                    }
                    newSettings.backupFolder = folder;
                }
            }
            const result = saveBackupSettings(app, newSettings);
            return result;
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('select-backup-folder', async () => {
        try {
            const { filePaths } = await dialog.showOpenDialog({
                title: 'Select Backup Destination Folder (e.g. Google Drive folder)',
                properties: ['openDirectory', 'createDirectory']
            });

            if (filePaths && filePaths.length > 0) {
                const folderPath = filePaths[0].trim();
                saveBackupSettings(app, { backupFolder: folderPath });
                return { success: true, folderPath };
            }
            return { success: false, message: 'Folder selection cancelled' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('perform-backup', async () => {
        try {
            const result = await executeBackup(dbModule, app);
            await dbModule.logActivity('admin', 'Cloud Backup', `Created backup in Pakistani Timezone: ${result.fileName}`);
            return result;
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('list-backups', async () => {
        try {
            const settings = getBackupSettings(app);
            const folder = (settings.backupFolder || getDefaultBackupFolder(app)).trim().replace(/^["']|["']$/g, '');
            if (!fs.existsSync(folder)) {
                return { success: true, backups: [], folder };
            }

            const files = fs.readdirSync(folder)
                .filter(f => f.startsWith('esms_backup_') && f.endsWith('.json'))
                .map(f => {
                    const filePath = path.join(folder, f);
                    const stat = fs.statSync(filePath);
                    return {
                        name: f,
                        path: filePath,
                        sizeBytes: stat.size,
                        formattedSize: (stat.size / 1024).toFixed(1) + ' KB',
                        mtime: stat.mtime,
                        readablePakistanTime: getPakistanReadableDateTime(stat.mtime)
                    };
                })
                .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

            return { success: true, backups: files, folder };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('restore-backup-file', async (event, customPath) => {
        try {
            let targetPath = customPath;
            if (!targetPath) {
                const { filePaths } = await dialog.showOpenDialog({
                    title: 'Select Backup JSON File to Restore',
                    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
                    properties: ['openFile']
                });
                if (!filePaths || filePaths.length === 0) {
                    return { success: false, message: 'Restore cancelled' };
                }
                targetPath = filePaths[0];
            }

            if (!fs.existsSync(targetPath)) {
                return { success: false, message: 'Selected backup file not found' };
            }

            const content = fs.readFileSync(targetPath, 'utf8');
            const backup = JSON.parse(content);

            if (!backup.data) {
                return { success: false, message: 'Invalid backup file structure' };
            }

            await restoreFromData(dbModule, backup.data);
            await dbModule.logActivity('admin', 'Restore Backup', `Restored database from ${path.basename(targetPath)}`);
            return { success: true, message: `Database successfully restored from ${path.basename(targetPath)}!` };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    // SQLite to MySQL Data Import / Migration
    ipcMain.handle('migrate-sqlite-file', async () => {
        try {
            const { filePaths } = await dialog.showOpenDialog({
                title: 'Select SQLite Database File to Migrate',
                filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
                properties: ['openFile']
            });

            if (filePaths && filePaths.length > 0) {
                const res = await migrateSqliteToMysql(filePaths[0]);
                return res;
            }
            return { success: false, message: 'Migration cancelled' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    // Manual Export to chosen file
    ipcMain.handle('export-database', async () => {
        try {
            const pktTs = getPakistanTimestamp();
            const { filePath } = await dialog.showSaveDialog({
                title: 'Export Database Backup',
                defaultPath: `esms_mysql_backup_${pktTs}.json`,
                filters: [{ name: 'JSON Backup', extensions: ['json'] }]
            });

            if (filePath) {
                const targetDir = path.dirname(filePath);
                const res = await executeBackup(dbModule, app, targetDir);
                if (res.filePath !== filePath) {
                    fs.copyFileSync(res.filePath, filePath);
                }
                return { success: true, message: 'Database backup exported successfully!' };
            }
            return { success: false, message: 'Export cancelled' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    // Manual Import from chosen file
    ipcMain.handle('import-database', async () => {
        try {
            const { filePaths } = await dialog.showOpenDialog({
                title: 'Import Database Backup',
                filters: [{ name: 'JSON Backup', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (filePaths && filePaths.length > 0) {
                const content = fs.readFileSync(filePaths[0], 'utf8');
                const backup = JSON.parse(content);

                if (!backup.data) {
                    return { success: false, message: 'Invalid backup file format' };
                }

                await restoreFromData(dbModule, backup.data);
                return { success: true, message: 'Database backup imported successfully into MySQL!' };
            }
            return { success: false, message: 'Import cancelled' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });
}

async function runAutoBackupIfNeeded(dbModule, app, log) {
    try {
        const settings = getBackupSettings(app);
        if (settings.autoBackupEnabled === false) return;

        const todayPkt = getPakistanDateOnly();
        if (settings.lastBackupDate) {
            const lastBackupPkt = getPakistanDateOnly(new Date(settings.lastBackupDate));
            if (lastBackupPkt === todayPkt) {
                // Already backed up today in Pakistan timezone
                return;
            }
        }

        if (log) log.info(`Running automated daily backup (PKT date: ${todayPkt})...`);
        const res = await executeBackup(dbModule, app);
        if (log) log.info(`Automated backup complete: ${res.fileName}`);
    } catch (e) {
        if (log) log.error('Automated backup error:', e.message);
    }
}

module.exports = registerUtilityHandlers;
module.exports.runAutoBackupIfNeeded = runAutoBackupIfNeeded;
module.exports.getBackupSettings = getBackupSettings;
module.exports.saveBackupSettings = saveBackupSettings;
module.exports.executeBackup = executeBackup;
module.exports.getPakistanTimestamp = getPakistanTimestamp;
module.exports.getPakistanReadableDateTime = getPakistanReadableDateTime;
module.exports.getPakistanDateOnly = getPakistanDateOnly;
