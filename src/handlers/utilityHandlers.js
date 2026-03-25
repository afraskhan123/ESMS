const fs = require('fs');
const path = require('path');

function registerUtilityHandlers(context) {
    const { ipcMain, dbModule, log, app, dialog } = context;

    ipcMain.handle('log', (event, level, message) => {
        if (log[level]) {
            log[level](`[Renderer] ${message}`);
        } else {
            log.info(`[Renderer] ${message}`);
        }
    });

    ipcMain.handle('clear-activity-logs', async () => {
        try {
            await dbModule.dbRun('DELETE FROM activity_logs');
            dbModule.logActivity('admin', 'Clear Logs', 'Cleared all activity logs');
            return { success: true };
        } catch (err) {
            log.error('Error clearing activity logs:', err);
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-activity-logs', async (event, limit = 100) => {
        try {
            const rows = await dbModule.dbAll('SELECT * FROM activity_logs ORDER BY log_id DESC LIMIT ?', [limit]);
            return { success: true, logs: rows };
        } catch (err) {
            log.error('Error fetching activity logs:', err);
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-categories', async () => {
        return new Promise((resolve, reject) => {
            dbModule.db.all('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category', (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, categories: rows.map(r => r.category) });
                }
            });
        });
    });

    ipcMain.handle('get-brands', async () => {
        return new Promise((resolve, reject) => {
            dbModule.db.all('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL ORDER BY brand', (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, brands: rows.map(r => r.brand) });
                }
            });
        });
    });

    ipcMain.handle('export-database', async () => {
        return new Promise(async (resolve, reject) => {
            try {
                const { filePath } = await dialog.showSaveDialog({
                    title: 'Export Database',
                    defaultPath: `esms_backup_${new Date().toISOString().split('T')[0]}.db`,
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
                });

                if (filePath) {
                    const dbPath = path.join(app.getPath('userData'), 'esms.db');
                    fs.copyFile(dbPath, filePath, (err) => {
                        if (err) {
                            reject({ success: false, message: err.message });
                        } else {
                            resolve({ success: true, message: 'Database exported successfully' });
                        }
                    });
                } else {
                    resolve({ success: false, message: 'Export cancelled' });
                }
            } catch (error) {
                reject({ success: false, message: error.message });
            }
        });
    });

    ipcMain.handle('import-database', async () => {
        return new Promise(async (resolve, reject) => {
            try {
                const { filePaths } = await dialog.showOpenDialog({
                    title: 'Import Database',
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    properties: ['openFile']
                });

                if (filePaths && filePaths.length > 0) {
                    const sourcePath = filePaths[0];
                    const dbPath = path.join(app.getPath('userData'), 'esms.db');
                    const backupPath = path.join(app.getPath('userData'), 'esms.db.bak');

                    const currentDb = dbModule.db;

                    if (currentDb) {
                        currentDb.close((err) => {
                            if (err) {
                                return reject({ success: false, message: 'Could not close database connection' });
                            }

                            fs.copyFile(dbPath, backupPath, (err) => {
                                if (err) {
                                    console.warn('Backup failed:', err);
                                }

                                fs.copyFile(sourcePath, dbPath, (err) => {
                                    if (err) {
                                        fs.copyFile(backupPath, dbPath, () => { });
                                        reject({ success: false, message: 'Import failed: ' + err.message });
                                    } else {
                                        resolve({ success: true, message: 'Database imported successfully. The application will restart.' });
                                        setTimeout(() => {
                                            app.relaunch();
                                            app.exit(0);
                                        }, 1500);
                                    }
                                });
                            });
                        });
                    } else {
                        fs.copyFile(sourcePath, dbPath, (err) => {
                            if (err) {
                                reject({ success: false, message: 'Import failed: ' + err.message });
                            } else {
                                resolve({ success: true, message: 'Database imported successfully. The application will restart.' });
                                setTimeout(() => {
                                    app.relaunch();
                                    app.exit(0);
                                }, 1500);
                            }
                        });
                    }
                } else {
                    resolve({ success: false, message: 'Import cancelled' });
                }
            } catch (error) {
                reject({ success: false, message: error.message });
            }
        });
    });
}

module.exports = registerUtilityHandlers;
