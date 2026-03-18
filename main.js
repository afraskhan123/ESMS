const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const dbModule = require('./database');

// Configure Technical Logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('Application starting...');

let mainWindow;
let currentUser = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false  // Allow file:// URIs for customer images stored in userData
        },
        icon: path.join(__dirname, 'assets', 'logo.jpg'),
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
    try {
        // Initialize database and wait for it to be ready
        await dbModule.initializeDatabase();
        console.log('Database initialized successfully before window creation.');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        // We still create the window so the user sees something, but they might face errors
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

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

// ═══════════════════════════════════════════════════════════
// AUTHENTICATION HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('login', async (event, { username, password }) => {
    return new Promise((resolve, reject) => {
        const hashedPassword = dbModule.hashPassword(password);
        dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?',
            [username, hashedPassword],
            (err, row) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else if (row) {
                    dbModule.logActivity(username, 'Login', 'User successfully logged in.');
                    currentUser = { id: row.admin_id, username: row.username };
                    let pImage = row.profile_image;
                    if (pImage && fs.existsSync(pImage)) {
                        try {
                            const ext = path.extname(pImage).slice(1);
                            const b64 = fs.readFileSync(pImage).toString('base64');
                            pImage = `data:image/${ext};base64,${b64}`;
                        } catch (e) { }
                    }
                    resolve({ success: true, admin: { id: row.admin_id, username: row.username, profile_image: pImage } });
                } else {
                    dbModule.logActivity(username, 'Login Failed', 'Invalid username or password attempt.');
                    resolve({ success: false, message: 'Invalid username or password' });
                }
            }
        );
    });
});

ipcMain.handle('change-password', async (event, { username, oldPassword, newPassword }) => {
    return new Promise((resolve, reject) => {
        const hashedOldPassword = dbModule.hashPassword(oldPassword);
        const hashedNewPassword = dbModule.hashPassword(newPassword);

        dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?',
            [username, hashedOldPassword],
            (err, row) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else if (row) {
                    dbModule.db.run('UPDATE admin SET password = ? WHERE username = ?',
                        [hashedNewPassword, username],
                        (err) => {
                            if (err) {
                                reject({ success: false, message: err.message });
                            } else {
                                resolve({ success: true, message: 'Password changed successfully' });
                            }
                        }
                    );
                } else {
                    resolve({ success: false, message: 'Current password is incorrect' });
                }
            }
        );
    });
});

// ═══════════════════════════════════════════════════════════
// PRODUCT MANAGEMENT HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-all-products', async (event, filters = {}) => {
    return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM products';
        const params = [];

        if (filters.category) {
            query += ' WHERE category = ?';
            params.push(filters.category);
        } else if (filters.lowStock) {
            query += ' WHERE stock_qty < min_stock_level';
        }

        query += ' ORDER BY product_id DESC';

        dbModule.db.all(query, params, (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, products: rows });
            }
        });
    });
});

ipcMain.handle('add-product', async (event, product) => {
    return new Promise((resolve, reject) => {
        const { name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period } = product;

        if (purchase_price < 0 || selling_price < 0 || stock_qty < 0 || min_stock_level < 0) {
            return resolve({ success: false, message: 'Product values cannot be negative' });
        }

        dbModule.db.run(
            `INSERT INTO products (name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period],
            function (err) {
                if (err) {
                    resolve({ success: false, message: err.message });
                } else {
                    dbModule.logActivity(currentUser?.username || 'admin', 'Add Product', `Added product: ${name}. Category: ${category || 'N/A'}, Price: Rs. ${selling_price}, Initial Stock: ${stock_qty} (ID: ${this.lastID})`);
                    resolve({ success: true, message: 'Product added successfully', product_id: this.lastID });
                }
            }
        );
    });
});

ipcMain.handle('update-product', async (event, product) => {
    return new Promise((resolve, reject) => {
        const { product_id, name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period } = product;

        if (purchase_price < 0 || selling_price < 0 || stock_qty < 0 || min_stock_level < 0) {
            return resolve({ success: false, message: 'Product values cannot be negative' });
        }

        // Core update without last_updated (safe for legacy databases missing the column)
        dbModule.db.run(
            `UPDATE products SET name = ?, category = ?, brand = ?, purchase_price = ?, selling_price = ?,
             stock_qty = ?, min_stock_level = ?, supplier_name = ?, warranty_period = ? WHERE product_id = ?`,
            [name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period, product_id],
            (err) => {
                if (err) {
                    return resolve({ success: false, message: err.message });
                }
                dbModule.logActivity(currentUser?.username || 'admin', 'Update Product', `Updated product: ${name} (ID: ${product_id}). New Price: Rs. ${selling_price}, New Stock: ${stock_qty}`);
                // Try to update last_updated separately; silently ignore if column doesn't exist yet
                dbModule.db.run(
                    'UPDATE products SET last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
                    [product_id],
                    () => { /* ignore error – column added by migration on next restart */ }
                );
                resolve({ success: true, message: 'Product updated successfully' });
            }
        );
    });
});

ipcMain.handle('delete-product', async (event, product_id) => {
    return new Promise((resolve, reject) => {
        dbModule.db.run('DELETE FROM products WHERE product_id = ?', [product_id], (err) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                dbModule.logActivity(currentUser?.username || 'admin', 'Delete Product', `Deleted product ID: ${product_id}`);
                resolve({ success: true, message: 'Product deleted successfully' });
            }
        });
    });
});


ipcMain.handle('recover-password', async (event, data) => {
    return new Promise((resolve, reject) => {
        const { code, newPassword } = data;
        const hashedCode = dbModule.hashPassword(code);
        const hashedPassword = dbModule.hashPassword(newPassword);

        dbModule.db.get('SELECT * FROM admin WHERE recovery_code = ?', [hashedCode], (err, row) => {
            if (err) {
                resolve({ success: false, message: err.message });
            } else if (!row) {
                resolve({ success: false, message: 'Invalid recovery code' });
            } else {
                dbModule.db.run('UPDATE admin SET password = ? WHERE admin_id = ?', [hashedPassword, row.admin_id], (err) => {
                    if (err) {
                        resolve({ success: false, message: err.message });
                    } else {
                        resolve({ success: true, message: 'Password reset successfully' });
                    }
                });
            }
        });
    });
});

ipcMain.handle('update-recovery-code', async (event, data) => {
    return new Promise((resolve, reject) => {
        const { username, currentPassword, newCode } = data;
        const hashedPassword = dbModule.hashPassword(currentPassword);
        const hashCode = dbModule.hashPassword(newCode);

        // Verify current password first
        dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?', [username, hashedPassword], (err, row) => {
            if (err) {
                resolve({ success: false, message: err.message });
            } else if (!row) {
                resolve({ success: false, message: 'Incorrect current password' });
            } else {
                dbModule.db.run('UPDATE admin SET recovery_code = ? WHERE username = ?', [hashCode, username], (err) => {
                    if (err) {
                        resolve({ success: false, message: err.message });
                    } else {
                        resolve({ success: true, message: 'Recovery code updated successfully' });
                    }
                });
            }
        });
    });
});

ipcMain.handle('update-profile', async (event, data) => {
    return new Promise(async (resolve, reject) => {
        const { username, newUsername, imagePath } = data;
        let finalImagePath = null;

        // 1. Check if new username is taken (if changed)
        if (newUsername !== username) {
            const checkQuery = 'SELECT * FROM admin WHERE username = ?';
            const existingUser = await new Promise((res) => {
                dbModule.db.get(checkQuery, [newUsername], (err, row) => res(row));
            });

            if (existingUser) {
                return reject({ success: false, message: 'Username already taken' });
            }
        }

        // 2. Handle Image Upload
        if (imagePath) {
            try {
                const userDataPath = app.getPath('userData');
                const profilesDir = path.join(userDataPath, 'profiles');
                if (!fs.existsSync(profilesDir)) {
                    fs.mkdirSync(profilesDir, { recursive: true });
                }

                if (imagePath.startsWith('data:image/')) {
                    const matches = imagePath.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                        const fileName = `profile_${new Date().getTime()}.${ext}`;
                        finalImagePath = path.join(profilesDir, fileName);
                        const buffer = Buffer.from(matches[2], 'base64');
                        fs.writeFileSync(finalImagePath, buffer);
                    }
                } else if (imagePath && typeof imagePath === 'string' && fs.existsSync(imagePath)) {
                    const ext = path.extname(imagePath);
                    const fileName = `profile_${new Date().getTime()}${ext}`;
                    finalImagePath = path.join(profilesDir, fileName);
                    await fs.promises.copyFile(imagePath, finalImagePath);
                } else {
                    console.error('Invalid imagePath provided');
                }
            } catch (error) {
                console.error('Error saving profile image:', error);
                return reject({ success: false, message: 'Failed to save profile image' });
            }
        }

        // 3. Update Database
        let updateQuery = 'UPDATE admin SET username = ?';
        let params = [newUsername];

        if (finalImagePath) {
            updateQuery += ', profile_image = ?';
            params.push(finalImagePath);
        }

        updateQuery += ' WHERE username = ?';
        params.push(username);

        dbModule.db.run(updateQuery, params, function (err) {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                let pImage = finalImagePath;
                if (pImage && fs.existsSync(pImage)) {
                    try {
                        const ext = path.extname(pImage).slice(1);
                        const b64 = fs.readFileSync(pImage).toString('base64');
                        pImage = `data:image/${ext};base64,${b64}`;
                    } catch (e) { }
                }
                resolve({
                    success: true,
                    message: 'Profile updated successfully',
                    user: { username: newUsername, profile_image: pImage }
                });
            }
        });
    });
});

ipcMain.handle('search-products', async (event, searchTerm) => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM products WHERE name LIKE ? OR category LIKE ? OR brand LIKE ? ORDER BY product_id DESC';
        const term = `%${searchTerm}%`;

        dbModule.db.all(query, [term, term, term], (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, products: rows });
            }
        });
    });
});

ipcMain.handle('get-low-stock-products', async () => {
    return new Promise((resolve, reject) => {
        dbModule.db.all('SELECT * FROM products WHERE stock_qty < min_stock_level', (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, products: rows });
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// CUSTOMER MANAGEMENT HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-all-customers', async () => {
    return new Promise((resolve, reject) => {
        dbModule.db.all('SELECT * FROM customers WHERE is_deleted = 0 ORDER BY customer_id DESC', (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                const processedRows = rows.map(row => {
                    let pImage = row.image_path;
                    if (pImage && fs.existsSync(pImage)) {
                        try {
                            const ext = path.extname(pImage).slice(1);
                            const b64 = fs.readFileSync(pImage).toString('base64');
                            pImage = `data:image/${ext};base64,${b64}`;
                        } catch (e) {
                            console.error('Error processing customer image:', e);
                        }
                    }
                    return { ...row, image_path: pImage };
                });
                resolve({ success: true, customers: processedRows });
            }
        });
    });
});


ipcMain.handle('add-customer', async (event, customer) => {
    return new Promise((resolve, reject) => {
        let imagePath = null;
        const { fullName, phone, idNumber, address, email, imageData } = customer;

        // Manual uniqueness check for id_number (Ignore soft-deleted records)
        if (idNumber && idNumber.trim() !== '') {
            dbModule.db.get('SELECT customer_id FROM customers WHERE id_number = ? AND is_deleted = 0', [idNumber], (err, row) => {
                if (err) return resolve({ success: false, message: 'Database error: ' + err.message });
                if (row) return resolve({ success: false, message: 'Customer CNIC already exists' });
                
                proceedWithInsert();
            });
        } else {
            proceedWithInsert();
        }

        function proceedWithInsert() {
            let imagePathResult = null;
            if (imageData) {
                try {
                    const assetsDir = path.join(app.getPath('userData'), 'assets', 'customers');
                    if (!fs.existsSync(assetsDir)) {
                        fs.mkdirSync(assetsDir, { recursive: true });
                    }
                    const fileName = `customer_${Date.now()}.png`;
                    const filePath = path.join(assetsDir, fileName);
                    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
                    fs.writeFileSync(filePath, base64Data, 'base64');
                    imagePathResult = filePath;
                } catch (e) {
                    console.error('Error saving customer image:', e);
                }
            }

            const query = 'INSERT INTO customers (full_name, phone, id_number, address, email, image_path) VALUES (?, ?, ?, ?, ?, ?)';
            dbModule.db.run(query, [
                fullName,
                phone,
                idNumber,
                address,
                email,
                imagePathResult
            ], function (err) {
                if (err) {
                    resolve({ success: false, message: err.message });
                } else {
                    dbModule.logActivity(currentUser?.username || 'admin', 'Add Customer', `Added customer: ${fullName}. CNIC: ${idNumber || 'N/A'} (ID: ${this.lastID})`);
                    resolve({ success: true, message: 'Customer added successfully', customer_id: this.lastID });
                }
            });
        }
    });
});

ipcMain.handle('update-customer', async (event, customer) => {
    return new Promise((resolve, reject) => {
        let { customer_id, fullName, phone, address, idNumber, email, imageData, imagePath } = customer;

        // Manual uniqueness check for id_number (Ignore soft-deleted records)
        if (idNumber && idNumber.trim() !== '') {
            dbModule.db.get('SELECT customer_id FROM customers WHERE id_number = ? AND customer_id != ? AND is_deleted = 0', [idNumber, customer_id], (err, row) => {
                if (err) return resolve({ success: false, message: 'Database error: ' + err.message });
                if (row) return resolve({ success: false, message: 'Customer CNIC already exists' });
                
                proceedWithUpdate();
            });
        } else {
            proceedWithUpdate();
        }

        function proceedWithUpdate() {
            let finalImagePath = imagePath; // maintain existing path if no new data

            if (imageData) {
                try {
                    const assetsDir = path.join(app.getPath('userData'), 'assets', 'customers');
                    if (!fs.existsSync(assetsDir)) {
                        fs.mkdirSync(assetsDir, { recursive: true });
                    }
                    const fileName = `customer_${Date.now()}.png`;
                    const filePath = path.join(assetsDir, fileName);
                    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
                    fs.writeFileSync(filePath, base64Data, 'base64');
                    finalImagePath = filePath;
                } catch (e) {
                    console.error('Error updating customer image:', e);
                }
            }

            const query = 'UPDATE customers SET full_name = ?, phone = ?, address = ?, id_number = ?, email = ?, image_path = ? WHERE customer_id = ?';
            dbModule.db.run(
                query,
                [fullName, phone, address, idNumber, email, finalImagePath, customer_id],
                function (err) {
                    if (err) {
                        resolve({ success: false, message: err.message });
                    } else {
                        dbModule.logActivity(currentUser?.username || 'admin', 'Update Customer', `Updated customer: ${fullName} (ID: ${customer_id}). New CNIC: ${idNumber || 'N/A'}`);
                        resolve({ success: true, message: 'Customer updated successfully' });
                    }
                }
            );
        }
    });
});

ipcMain.handle('delete-customer', async (event, customer_id) => {
    return new Promise((resolve, reject) => {
        // 1. Check if customer has any active or overdue installments
        const checkQuery = `
            SELECT i.status 
            FROM installments i
            JOIN sales s ON i.sale_id = s.sale_id
            WHERE s.customer_id = ? AND i.status IN ('Active', 'Overdue')
        `;

        dbModule.db.all(checkQuery, [customer_id], (err, activeInstallments) => {
            if (err) return resolve({ success: false, message: err.message });

            if (activeInstallments && activeInstallments.length > 0) {
                return resolve({
                    success: false,
                    message: 'Cannot delete this customer. They have pending or overdue installments. Please complete or delete the installments first.'
                });
            }

            // 2. Soft delete: Mark customer as deleted but keep record for reports/invoices
            dbModule.db.run('UPDATE customers SET is_deleted = 1 WHERE customer_id = ?', [customer_id], (err) => {
                if (err) {
                    return resolve({ success: false, message: 'Failed to delete customer: ' + err.message });
                }
                dbModule.logActivity(currentUser?.username || 'admin', 'Delete Customer', `Deleted customer ID: ${customer_id}`);
                resolve({ success: true, message: 'Customer deleted successfully' });
            });
        });
    });
});

ipcMain.handle('search-customers', async (event, searchTerm) => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM customers WHERE is_deleted = 0 AND (full_name LIKE ? OR phone LIKE ?) ORDER BY customer_id DESC';
        const term = `%${searchTerm}%`;

        dbModule.db.all(query, [term, term], (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                const processedRows = rows.map(row => {
                    let pImage = row.image_path;
                    if (pImage && fs.existsSync(pImage)) {
                        try {
                            const ext = path.extname(pImage).slice(1);
                            const b64 = fs.readFileSync(pImage).toString('base64');
                            pImage = `data:image/${ext};base64,${b64}`;
                        } catch (e) {
                            console.error('Error processing customer image:', e);
                        }
                    }
                    return { ...row, image_path: pImage };
                });
                resolve({ success: true, customers: processedRows });
            }
        });
    });
});

ipcMain.handle('get-customer-history', async (event, customer_id) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT s.*, 
                   GROUP_CONCAT(si.product_name || ' (x' || si.quantity || ')') as items,
                   i.installment_id, i.remaining_balance, i.status as installment_status
            FROM sales s
            LEFT JOIN sale_items si ON s.sale_id = si.sale_id
            LEFT JOIN installments i ON s.sale_id = i.sale_id
            WHERE s.customer_id = ? AND s.is_deleted = 0
            GROUP BY s.sale_id
            ORDER BY s.sale_date DESC
        `;

        dbModule.db.all(query, [customer_id], (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                const sales = rows.map(row => ({
                    ...row,
                    installment: row.installment_id ? {
                        installment_id: row.installment_id,
                        remaining_balance: row.remaining_balance,
                        status: row.installment_status
                    } : null
                }));
                resolve({ success: true, sales });
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// SALES MANAGEMENT HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('create-sale', async (event, saleData) => {
    return new Promise((resolve, reject) => {
        try {
            const { customer_id, walkin_name, items, payment_type, total_amount, installment_data } = saleData;
            
            if (!items || !Array.isArray(items)) {
                return resolve({ success: false, message: 'Invalid items provided' });
            }

            if (total_amount < 0) {
                return resolve({ success: false, message: 'Total amount cannot be negative' });
            }

        const getWalkinId = () => {
            return new Promise((res) => {
                if (!customer_id || customer_id === '0') {
                    dbModule.getDatabase().get('SELECT MAX(walkin_id) as maxId FROM sales', (err, row) => {
                        res(row && row.maxId ? row.maxId + 1 : 1);
                    });
                } else {
                    res(null);
                }
            });
        };

        const proceedWithSale = (walkin_id = null) => {
            dbModule.db.serialize(() => {
                dbModule.db.run('BEGIN TRANSACTION');

                // Insert sale
                dbModule.db.run(
                    'INSERT INTO sales (customer_id, walkin_name, walkin_id, total_amount, payment_type) VALUES (?, ?, ?, ?, ?)',
                    [customer_id, walkin_name, walkin_id, total_amount, payment_type],
                function (err) {
                    if (err) {
                        dbModule.db.run('ROLLBACK');
                        return resolve({ success: false, message: err.message });
                    }

                    const sale_id = this.lastID;

                    // Insert sale items and update stock
                    let itemsProcessed = 0;
                    let errorOccurred = false;

                    // We need to process items sequentially to handle errors/rollbacks correctly
                    // However, for simplicity in this callback style, we check error flag
                    const processNextItem = (index) => {
                        if (index >= items.length) {
                            if (!errorOccurred) {
                                // All items processed successfully, handle installment or commit
                                finalizeSale();
                            }
                            return;
                        }

                        const item = items[index];
                        dbModule.db.run(
                            'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [sale_id, item.product_id, item.product_name, item.quantity, item.unit_price, item.subtotal, item.purchase_price || 0],
                            (err) => {
                                if (err) {
                                    if (!errorOccurred) {
                                        errorOccurred = true;
                                        dbModule.db.run('ROLLBACK');
                                        resolve({ success: false, message: err.message });
                                    }
                                    return;
                                }

                                // Update product stock with VALIDATION (only if product_id exists)
                                if (item.product_id) {
                                    dbModule.db.run(
                                        'UPDATE products SET stock_qty = stock_qty - ? WHERE product_id = ? AND stock_qty >= ?',
                                        [item.quantity, item.product_id, item.quantity],
                                        function (err) {
                                            if (err) {
                                                if (!errorOccurred) {
                                                    errorOccurred = true;
                                                    dbModule.db.run('ROLLBACK');
                                                    resolve({ success: false, message: err.message });
                                                }
                                                return;
                                            }

                                            if (this.changes === 0) {
                                                if (!errorOccurred) {
                                                    errorOccurred = true;
                                                    dbModule.db.run('ROLLBACK');
                                                    resolve({ success: false, message: `Insufficient stock for product: ${item.product_name}` });
                                                }
                                                return;
                                            }

                                            // Proceed to next item
                                            processNextItem(index + 1);
                                        }
                                    );
                                } else {
                                    // No product_id (custom item) — no stock to update
                                    processNextItem(index + 1);
                                }
                            }
                        );
                    };

                    const finalizeSale = () => {
                        // If installment, create installment record
                        if (payment_type === 'Installment' && installment_data) {
                            const { down_payment, installment_duration, monthly_amount, next_due_date,
                                guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address } = installment_data;
                            const remaining_balance = total_amount - down_payment;

                            dbModule.db.run(
                                `INSERT INTO installments (sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date, guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date,
                                    guarantor_name || null, guarantor_cnic || null, guarantor_mobile || null, guarantor_address || null],
                                (err) => {
                                    if (err) {
                                        dbModule.db.run('ROLLBACK');
                                        return resolve({ success: false, message: err.message });
                                    }

                                    dbModule.db.run('COMMIT', (err) => {
                                        if (err) {
                                            dbModule.db.run('ROLLBACK');
                                            return resolve({ success: false, message: err.message });
                                        }
                                        const productNames = items.map(i => i.product_name).join(', ');
                                        dbModule.logActivity(currentUser?.username || 'admin', 'Create Sale', `New installment sale (ID: ${sale_id}). Customer ID: ${customer_id}, Products: ${productNames}, Total: Rs. ${total_amount}, Duration: ${installment_duration} Mo.`);
                                        resolve({ success: true, message: 'Sale created successfully', sale_id });
                                    });
                                }
                            );
                        } else {
                            dbModule.db.run('COMMIT', (err) => {
                                if (err) {
                                    dbModule.db.run('ROLLBACK');
                                    return resolve({ success: false, message: err.message });
                                }
                                const productNames = items.map(i => i.product_name).join(', ');
                                dbModule.logActivity(currentUser?.username || 'admin', 'Create Sale', `New cash sale (ID: ${sale_id}). Customer: ${customer_id ? 'ID ' + customer_id : (walkin_name || 'Walk-in')}, Products: ${productNames}, Total: Rs. ${total_amount}`);
                                resolve({ success: true, message: 'Sale created successfully', sale_id });
                            });
                        }
                    };

                    // Start processing items
                    processNextItem(0);
                }
            );
        });
        };

        getWalkinId().then(wId => {
            proceedWithSale(wId);
        });
        } catch (error) {
            return resolve({ success: false, message: error.message || 'An unknown error occurred during sale creation' });
        }
    });
});

ipcMain.handle('get-all-sales', async (event, filters = {}) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE s.is_hidden = 0 AND s.is_deleted = 0
            ORDER BY s.sale_date DESC
        `;

        dbModule.db.all(query, (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, sales: rows });
            }
        });
    });
});

ipcMain.handle('delete-all-sales', async () => {
    return new Promise((resolve, reject) => {
        // Soft delete: hide from recent history but keep data for invoices/reports
        dbModule.db.run('UPDATE sales SET is_hidden = 1', (err) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, message: 'Recent sales history cleared from view' });
            }
        });
    });
});

ipcMain.handle('get-sale-details', async (event, sale_id) => {
    return new Promise((resolve, reject) => {
        const saleQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id, c.phone, c.address,
                       i.installment_id, i.down_payment, i.installment_duration, i.monthly_amount, i.next_due_date, i.remaining_balance,
                       i.guarantor_name, i.guarantor_cnic, i.guarantor_mobile, i.guarantor_address
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE s.sale_id = ? AND s.is_deleted = 0
            `;

        dbModule.db.get(saleQuery, [sale_id], (err, sale) => {
            if (err) {
                return reject({ success: false, message: err.message });
            }

            if (!sale) {
                return reject({ success: false, message: 'Sale not found' });
            }

            dbModule.db.all('SELECT * FROM sale_items WHERE sale_id = ?', [sale_id], (err, items) => {
                if (err) {
                    return reject({ success: false, message: err.message });
                }

                sale.items = items;

                // Fetch installment payments if it's an installment sale
                if (sale.payment_type === 'Installment' && sale.installment_id) {
                    dbModule.db.all('SELECT *, COALESCE(payment_method, \'Cash\') as payment_method FROM installment_payments WHERE installment_id = ? ORDER BY payment_date ASC',
                        [sale.installment_id],
                        (err, payments) => {
                            if (err) {
                                return reject({ success: false, message: err.message });
                            }
                            sale.payments = payments;
                            resolve({ success: true, sale });
                        });
                } else {
                    resolve({ success: true, sale });
                }
            });
        });
    });
});

ipcMain.handle('process-sale-return', async (event, { saleId, items }) => {
    return new Promise((resolve, reject) => {
        dbModule.db.serialize(() => {
            dbModule.db.run('BEGIN TRANSACTION');

            const processReturns = async () => {
                try {
                    let totalRefund = 0;
                    let returnedProductNames = [];

                    for (const itemReturn of items) {
                        const { saleItemId, returnQty } = itemReturn;

                        // 1. Get sale item details
                        const item = await new Promise((res, rej) => {
                            dbModule.db.get('SELECT * FROM sale_items WHERE sale_item_id = ?', [saleItemId], (err, row) => {
                                if (err) rej(err); else res(row);
                            });
                        });

                        if (!item) throw new Error('Sale item not found');
                        if (returnQty > (item.quantity - (item.returned_qty || 0))) {
                            throw new Error(`Return quantity for ${item.product_name} exceeds available quantity`);
                        }

                        const effectiveUnitPrice = item.subtotal / item.quantity;
                        const itemRefund = returnQty * effectiveUnitPrice;
                        totalRefund += itemRefund;

                        // 2. Update sale_items
                        await new Promise((res, rej) => {
                            dbModule.db.run('UPDATE sale_items SET returned_qty = COALESCE(returned_qty, 0) + ? WHERE sale_item_id = ?',
                                [returnQty, saleItemId], (err) => err ? rej(err) : res());
                        });

                        // 3. Update products stock
                        await new Promise((res, rej) => {
                            dbModule.db.run('UPDATE products SET stock_qty = stock_qty + ? WHERE product_id = ?',
                                [returnQty, item.product_id], (err) => err ? rej(err) : res());
                        });
                        
                        returnedProductNames.push(`${item.product_name} (x${returnQty})`);
                    }

                    // 4. Update sales total
                    await new Promise((res, rej) => {
                        dbModule.db.run('UPDATE sales SET total_amount = total_amount - ? WHERE sale_id = ?',
                            [totalRefund, saleId], (err) => err ? rej(err) : res());
                    });

                    // 5. Check for installments
                    const installment = await new Promise((res, rej) => {
                        dbModule.db.get('SELECT * FROM installments WHERE sale_id = ?', [saleId], (err, row) => {
                            if (err) rej(err); else res(row);
                        });
                    });

                    let responseMessage = 'Return processed successfully.';
                    let cashRefundAmount = totalRefund;
                    let deductedFromBalance = 0;

                    if (installment) {
                        const newTotal = installment.total_amount - totalRefund;
                        const newRemaining = Math.max(0, installment.remaining_balance - totalRefund);

                        // Calculate how much was deducted from the remaining balance and how much is a cash refund
                        deductedFromBalance = installment.remaining_balance - newRemaining;
                        cashRefundAmount = Math.max(0, totalRefund - deductedFromBalance);

                        const newStatus = newRemaining <= 0 ? 'Completed' : installment.status;

                        await new Promise((res, rej) => {
                            dbModule.db.run('UPDATE installments SET total_amount = ?, remaining_balance = ?, status = ? WHERE installment_id = ?',
                                [newTotal, newRemaining, newStatus, installment.installment_id], (err) => err ? rej(err) : res());
                        });

                        if (cashRefundAmount > 0) {
                            await new Promise((res, rej) => {
                                dbModule.db.run(
                                    'INSERT INTO installment_payments (installment_id, amount_paid, remaining_balance_after) VALUES (?, ?, ?)',
                                    [installment.installment_id, -cashRefundAmount, newRemaining],
                                    (err) => err ? rej(err) : res()
                                );
                            });
                        }

                        responseMessage = `Return processed. Rs. ${deductedFromBalance.toFixed(2)} deducted from balance. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                    } else {
                        responseMessage = `Return processed. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                    }

                    dbModule.db.run('COMMIT', (err) => {
                        if (err) throw err;
                        dbModule.logActivity(currentUser?.username || 'admin', 'Sale Return', `Processed return for Sale ID: ${saleId}. Products: ${returnedProductNames.join(', ')}. Refund: Rs. ${totalRefund.toFixed(2)}`);
                        resolve({
                            success: true,
                            message: responseMessage,
                            totalRefund: totalRefund,
                            cashRefundAmount: cashRefundAmount,
                            deductedFromBalance: deductedFromBalance
                        });
                    });

                } catch (error) {
                    dbModule.db.run('ROLLBACK');
                    resolve({ success: false, message: error.message });
                }
            };

            processReturns();
        });
    });
});

ipcMain.handle('download-invoice', async (event, saleId) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);

        // Let user choose where to save the file
        const { filePath } = await dialog.showSaveDialog(win, {
            title: 'Save Invoice PDF',
            defaultPath: `Invoice_${saleId}.pdf`,
            filters: [
                { name: 'PDF Document', extensions: ['pdf'] }
            ]
        });

        if (!filePath) {
            return { success: false, message: 'Download cancelled' };
        }

        // Print to PDF using Chromium's engine
        const pdfData = await event.sender.printToPDF({
            pageSize: 'A4',
            printBackground: true,
            marginType: 'custom',
            margins: {
                top: 0.3,
                bottom: 0.3,
                left: 0.3,
                right: 0.3
            }
        });

        fs.writeFileSync(filePath, pdfData);
        return { success: true, message: 'Invoice saved successfully', filePath };
    } catch (error) {
        console.error('Error generating PDF:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('get-daily-sales', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                COALESCE(SUM(
                    CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                         WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                         ELSE 0 END
                ), 0)
                + COALESCE((
                    SELECT SUM(ip.amount_paid)
                    FROM installment_payments ip
                    WHERE DATE(ip.payment_date) = DATE('now')
                ), 0) as total
            FROM sales s
            LEFT JOIN installments i ON s.sale_id = i.sale_id
            WHERE DATE(s.sale_date) = DATE('now') AND s.is_deleted = 0
        `;

        dbModule.db.get(query, (err, row) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, total: row.total });
            }
        });
    });
});

ipcMain.handle('get-monthly-sales', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                COALESCE(SUM(
                    CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                         WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                         ELSE 0 END
                ), 0)
                + COALESCE((
                    SELECT SUM(ip.amount_paid)
                    FROM installment_payments ip
                    WHERE strftime('%Y-%m', ip.payment_date) = strftime('%Y-%m', 'now')
                ), 0) as total
            FROM sales s
            LEFT JOIN installments i ON s.sale_id = i.sale_id
            WHERE strftime('%Y-%m', s.sale_date) = strftime('%Y-%m', 'now') AND s.is_deleted = 0
        `;

        dbModule.db.get(query, (err, row) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, total: row.total });
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// INSTALLMENT MANAGEMENT HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-all-installments', async (event, filters = {}) => {
    try {
        // First, update status based on next_due_date for all relevant installments
        // Using DATE('now', 'localtime') to match how alerts/stats are calculated
        await new Promise((resolve, reject) => {
            dbModule.db.serialize(() => {
                // Active becomes Overdue
                dbModule.db.run(`
                    UPDATE installments 
                    SET status = 'Overdue' 
                    WHERE status = 'Active' AND DATE(next_due_date) < DATE('now', 'localtime')
                `, (err) => { if (err) reject(err); });

                // Overdue becomes Active (if date was extended)
                dbModule.db.run(`
                    UPDATE installments 
                    SET status = 'Active' 
                    WHERE status = 'Overdue' AND DATE(next_due_date) >= DATE('now', 'localtime')
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        // Now fetch filtered results
        return new Promise((resolve, reject) => {
            let query = `
                SELECT i.*, c.full_name as customer_name, c.id_number, s.sale_date,
                (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.is_deleted = 0
            `;
            const params = [];

            if (filters.status === 'Overdue') {
                // Return items explicitly marked Overdue OR logically past due
                query += " AND (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now', 'localtime')))";
            } else if (filters.status === 'Active') {
                // Return items that are Active AND NOT yet past due
                query += " AND i.status = 'Active' AND DATE(i.next_due_date) >= DATE('now', 'localtime')";
            } else if (filters.status) {
                query += ' AND i.status = ?';
                params.push(filters.status);
            }

            query += ' ORDER BY i.installment_id DESC';

            dbModule.db.all(query, params, (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, installments: rows });
                }
            });
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('get-due-installments', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT i.*, c.full_name as customer_name
            FROM installments i
            JOIN sales s ON i.sale_id = s.sale_id
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE i.status IN ('Active', 'Overdue') AND DATE(i.next_due_date) <= DATE('now', 'localtime') AND s.is_deleted = 0
            ORDER BY i.next_due_date ASC
        `;

        dbModule.db.all(query, (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, installments: rows });
            }
        });
    });
});

ipcMain.handle('get-overdue-installments', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT i.*, c.full_name as customer_name
            FROM installments i
            JOIN sales s ON i.sale_id = s.sale_id
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now', 'localtime')))
            ORDER BY i.next_due_date ASC
        `;

        dbModule.db.all(query, (err, rows) => {
            if (err) {
                reject({ success: false, message: err.message });
            } else {
                resolve({ success: true, installments: rows });
            }
        });
    });
});

ipcMain.handle('record-installment-payment', async (event, paymentData) => {
    return new Promise((resolve, reject) => {
        const { installment_id, amount_paid, payment_method, next_due_date } = paymentData;

        if (amount_paid < 0) {
            return reject({ success: false, message: 'Payment amount cannot be negative' });
        }

        dbModule.db.serialize(() => {
            dbModule.db.run('BEGIN TRANSACTION');

            // Get current installment details
            dbModule.db.get('SELECT * FROM installments WHERE installment_id = ?', [installment_id], (err, installment) => {
                if (err) {
                    dbModule.db.run('ROLLBACK');
                    return reject({ success: false, message: err.message });
                }

                if (installment && amount_paid > installment.remaining_balance) {
                    dbModule.db.run('ROLLBACK');
                    return reject({ success: false, message: 'Payment amount exceeds remaining balance' });
                }

                const new_balance = installment.remaining_balance - amount_paid;
                const new_status = new_balance <= 0 ? 'Completed' : 'Active';

                // Ensure next due date is provided
                if (!next_due_date && new_status === 'Active') {
                    dbModule.db.run('ROLLBACK');
                    return reject({ success: false, message: 'Next due date is required' });
                }

                // Record payment
                dbModule.db.run(
                    'INSERT INTO installment_payments (installment_id, amount_paid, payment_method, remaining_balance_after) VALUES (?, ?, ?, ?)',
                    [installment_id, amount_paid, payment_method || 'Cash', new_balance],
                    (err) => {
                        if (err) {
                            dbModule.db.run('ROLLBACK');
                            return reject({ success: false, message: err.message });
                        }

                        // Update installment
                        dbModule.db.run(
                            'UPDATE installments SET remaining_balance = ?, status = ?, next_due_date = ? WHERE installment_id = ?',
                            [new_balance, new_status, next_due_date, installment_id],
                            (err) => {
                                if (err) {
                                    dbModule.db.run('ROLLBACK');
                                    return reject({ success: false, message: err.message });
                                }

                                dbModule.db.run('COMMIT', (err) => {
                                    if (err) {
                                        dbModule.db.run('ROLLBACK');
                                        return reject({ success: false, message: err.message });
                                    }
                                dbModule.logActivity(currentUser?.username || 'admin', 'Record Payment', `Recorded payment of Rs. ${amount_paid} (${payment_method || 'Cash'}) for Installment ID: ${installment_id}. New Balance: Rs. ${new_balance.toFixed(2)}`);
                                resolve({ success: true, message: 'Payment recorded successfully', new_balance });
                                });
                            }
                        );
                    }
                );
            });
        });
    });
});

ipcMain.handle('update-installment', async (event, installmentData) => {
    return new Promise((resolve, reject) => {
        const { installment_id, total_amount, remaining_balance, monthly_amount, next_due_date, status } = installmentData;

        if (total_amount < 0 || remaining_balance < 0 || monthly_amount < 0) {
            return reject({ success: false, message: 'Installment values cannot be negative' });
        }
        if (remaining_balance > total_amount) {
            return reject({ success: false, message: 'Remaining balance cannot be greater than total amount' });
        }

        dbModule.db.run(
            'UPDATE installments SET total_amount = ?, remaining_balance = ?, monthly_amount = ?, next_due_date = ?, status = ? WHERE installment_id = ?',
            [total_amount, remaining_balance, monthly_amount, next_due_date, status, installment_id],
            (err) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    dbModule.logActivity(currentUser?.username || 'admin', 'Update Installment', `Updated installment plan: ${installment_duration} months, Rs. ${monthly_amount}/mo for ID: ${installment_id}`);
                    resolve({ success: true, message: 'Installment plan updated successfully' });
                }
            }
        );
    });
});

ipcMain.handle('delete-installment', async (event, installment_id) => {
    return new Promise((resolve, reject) => {
        dbModule.db.serialize(() => {
            dbModule.db.run('BEGIN TRANSACTION');

            // 1. Get sale_id before completing anything
            dbModule.db.get('SELECT sale_id FROM installments WHERE installment_id = ?', [installment_id], (err, row) => {
                if (err || !row) {
                    dbModule.db.run('ROLLBACK');
                    return reject({ success: false, message: err ? err.message : 'Installment not found' });
                }
                const sale_id = row.sale_id;

                // 2. Instead of deleting, just mark installment as Completed (or Cancelled) to preserve history
                dbModule.db.run('UPDATE installments SET status = "Completed", remaining_balance = 0 WHERE installment_id = ?', [installment_id], (err) => {
                    if (err) {
                        dbModule.db.run('ROLLBACK');
                        return reject({ success: false, message: err.message });
                    }

                    // 3. Mark the sale as Returned
                    dbModule.db.run('UPDATE sales SET status = "Returned" WHERE sale_id = ?', [sale_id], (err) => {
                        if (err) {
                            dbModule.db.run('ROLLBACK');
                            return reject({ success: false, message: err.message });
                        }

                        dbModule.db.run('COMMIT', (err) => {
                            if (err) {
                                dbModule.db.run('ROLLBACK');
                                return reject({ success: false, message: err.message });
                            }
                            dbModule.logActivity(currentUser?.username || 'admin', 'Delete Installment', `Returned/Completed installment for Sale ID: ${sale_id}. Action: ${action}`);
                            resolve({ success: true, message: 'Installment returned successfully, history preserved.' });
                        });
                    });
                });
            });
        });
    });
});

ipcMain.handle('get-payment-history', async (event, installment_id) => {
    return new Promise((resolve, reject) => {
        dbModule.db.all(
            'SELECT * FROM installment_payments WHERE installment_id = ? ORDER BY payment_date DESC',
            [installment_id],
            (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, payments: rows });
                }
            }
        );
    });
});

ipcMain.handle('get-all-payments', async (event, filters = {}) => {
    return new Promise((resolve, reject) => {
        const { page = 1, pageSize = 10, search, startDate, endDate } = filters;
        const offset = (page - 1) * pageSize;

        let baseQuery = `
            FROM installment_payments ip
            JOIN installments i ON ip.installment_id = i.installment_id
            JOIN sales s ON i.sale_id = s.sale_id
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE s.is_deleted = 0
        `;

        const params = [];
        const conditions = [];

        if (search) {
            conditions.push('(c.full_name LIKE ? OR s.sale_id LIKE ? OR c.id_number LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (startDate) {
            conditions.push('DATE(ip.payment_date, "localtime") >= DATE(?, "localtime")');
            params.push(startDate);
        }

        if (endDate) {
            conditions.push('DATE(ip.payment_date, "localtime") <= DATE(?, "localtime")');
            params.push(endDate);
        }

        if (conditions.length > 0) {
            baseQuery += ' AND ' + conditions.join(' AND ');
        }

        const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
        const dataQuery = `
            SELECT ip.*, i.total_amount, i.monthly_amount, i.installment_id,
                   c.full_name as customer_name, s.sale_id
            ${baseQuery}
            ORDER BY ip.payment_date DESC
            LIMIT ? OFFSET ?
        `;

        dbModule.db.get(countQuery, params, (err, countRow) => {
            if (err) return reject({ success: false, message: err.message });

            const totalCount = countRow ? countRow.total : 0;
            const dataParams = [...params, pageSize, offset];

            dbModule.db.all(dataQuery, dataParams, (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({
                        success: true,
                        payments: rows,
                        totalCount,
                        page,
                        pageSize
                    });
                }
            });
        });
    });
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD & ALERTS HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-dashboard-stats', async () => {
    return new Promise((resolve, reject) => {
        const stats = {};

        // 1. Total Daily Sales (Cash/Down Payment) + Installment Payments Today
        const dailyQuery = `
            SELECT (
                SELECT COALESCE(SUM(
                    CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                         WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                         ELSE 0 END
                ), 0)
                FROM sales s
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE(s.sale_date, 'localtime') = DATE('now', 'localtime') AND s.is_deleted = 0
            ) + (
                SELECT COALESCE(SUM(ip.amount_paid), 0)
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                WHERE DATE(ip.payment_date, 'localtime') = DATE('now', 'localtime') AND s.is_deleted = 0
            ) as total
        `;

        dbModule.db.get(dailyQuery, (err, row) => {
            if (err) return reject({ success: false, message: err.message });
            stats.daily_sales = row.total;

            // 2. Total Monthly Sales (Cash/Down Payment) + Installment Payments This Month
            const monthlyQuery = `
                SELECT (
                    SELECT COALESCE(SUM(
                        CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                             WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                             ELSE 0 END
                    ), 0)
                    FROM sales s
                    LEFT JOIN installments i ON s.sale_id = i.sale_id
                    WHERE strftime('%Y-%m', s.sale_date, 'localtime') = strftime('%Y-%m', 'now', 'localtime') AND s.is_deleted = 0
                ) + (
                    SELECT COALESCE(SUM(ip.amount_paid), 0)
                    FROM installment_payments ip
                    JOIN installments i ON ip.installment_id = i.installment_id
                    JOIN sales s ON i.sale_id = s.sale_id
                    WHERE strftime('%Y-%m', ip.payment_date, 'localtime') = strftime('%Y-%m', 'now', 'localtime') AND s.is_deleted = 0
                ) as total
            `;

            dbModule.db.get(monthlyQuery, (err, row) => {
                if (err) return reject({ success: false, message: err.message });
                stats.monthly_sales = row.total;

                // Pending installments (joined with sales to check hidden status)
                dbModule.db.get(`
                    SELECT COALESCE(SUM(remaining_balance), 0) as total 
                    FROM installments i
                    JOIN sales s ON i.sale_id = s.sale_id
                    WHERE i.status IN ('Active', 'Overdue') AND s.is_deleted = 0
                `, (err, row) => {
                    if (err) return reject({ success: false, message: err.message });
                    stats.pending_installments = row.total;

                    // Overdue count (joined with sales to check hidden status)
                    dbModule.db.get(`
                        SELECT COUNT(*) as count 
                        FROM installments i
                        JOIN sales s ON i.sale_id = s.sale_id
                        WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now'))) AND s.is_deleted = 0
                    `, (err, row) => {
                        if (err) return reject({ success: false, message: err.message });
                        stats.overdue_count = row.count;

                            // Low stock count (independent of sales)
                            dbModule.db.get(`SELECT COUNT(*) as count FROM products WHERE stock_qty < min_stock_level`, (err, row) => {
                                if (err) return reject({ success: false, message: err.message });
                                stats.low_stock_count = row.count;

                                // 6. Total Customers count
                                dbModule.db.get(`SELECT COUNT(*) as count FROM customers WHERE is_deleted = 0`, (err, row) => {
                                    if (err) return reject({ success: false, message: err.message });
                                    stats.total_customers = row.count;

                                    resolve({ success: true, stats });
                                });
                            });
                    });
                });
            });
        });
    });
});

ipcMain.handle('get-dashboard-alerts', async () => {
    return new Promise((resolve, reject) => {
        const alerts = [];

        // Low stock alerts
        dbModule.db.all('SELECT * FROM products WHERE stock_qty < min_stock_level', (err, products) => {
            if (err) return reject({ success: false, message: err.message });

            products.forEach(p => {
                alerts.push({
                    severity: 'warning',
                    title: 'Low Stock Alert',
                    message: `${p.name} is running low (${p.stock_qty} remaining)`,
                    type: 'low-stock',
                    target: 'inventory'
                });
            });

            // Overdue installments
            dbModule.db.all(`
                SELECT i.*, COALESCE(c.full_name, s.walkin_name) as full_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now', 'localtime'))) AND s.is_deleted = 0
            `, (err, installments) => {
                if (err) return reject({ success: false, message: err.message });

                installments.forEach(inst => {
                    alerts.push({
                        severity: 'danger',
                        title: 'Overdue Payment',
                        message: `${inst.full_name || 'Customer'} has an overdue payment of Rs. ${inst.monthly_amount}`,
                        type: 'overdue',
                        target: 'installments'
                    });
                });

                // Due today
                dbModule.db.all(`
                    SELECT i.*, COALESCE(c.full_name, s.walkin_name) as full_name
                    FROM installments i
                    JOIN sales s ON i.sale_id = s.sale_id
                    LEFT JOIN customers c ON s.customer_id = c.customer_id
                    WHERE i.status = 'Active' AND DATE(i.next_due_date) = DATE('now', 'localtime') AND s.is_deleted = 0
                `, (err, dueToday) => {
                    if (err) return reject({ success: false, message: err.message });

                    dueToday.forEach(inst => {
                        alerts.push({
                            severity: 'warning',
                            title: 'Payment Due Today',
                            message: `${inst.full_name || 'Customer'} has a payment of Rs. ${inst.monthly_amount} due today`,
                            type: 'due-today',
                            target: 'installments'
                        });
                    });

                    resolve({ success: true, alerts });
                });
            });
        });
    });
});

// ═══════════════════════════════════════════════════════════
// REPORT HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-daily-sales-report', async (event, date) => {
    return new Promise((resolve, reject) => {
        const targetDate = date || new Date().toISOString().split('T')[0];

        const salesQuery = `
            SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
            (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN installments i ON s.sale_id = i.sale_id
            WHERE DATE(s.sale_date, 'localtime') = DATE(?, 'localtime') AND s.is_deleted = 0
            ORDER BY s.sale_id DESC
        `;

        dbModule.db.all(salesQuery, [targetDate], (err, salesRows) => {
            if (err) return reject({ success: false, message: err.message });

            // Query 2: Installment payments received on this date
            const paymentsQuery = `
                SELECT 
                    s.sale_id as sale_id,
                    s.customer_id as customer_id,
                    s.walkin_id as walkin_id,
                    ip.payment_date as sale_date,
                    ip.amount_paid as total_amount,
                    'Installment Payment' as payment_type,
                    COALESCE(c.full_name, s.walkin_name) as customer_name,
                    c.id_number,
                    0 as return_count,
                    ip.amount_paid as down_payment,
                    (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE DATE(ip.payment_date, 'localtime') = DATE(?, 'localtime') AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            dbModule.db.all(paymentsQuery, [targetDate], (err, paymentRows) => {
                if (err) return reject({ success: false, message: err.message });

                // Combine and sort
                const combined = [...(salesRows || []), ...(paymentRows || [])];
                combined.sort((a, b) => b.sale_id - a.sale_id);
                resolve({ success: true, sales: combined, date: targetDate });
            });
        });
    });
});

ipcMain.handle('get-monthly-sales-report', async (event, month) => {
    return new Promise((resolve, reject) => {
        // month format: YYYY-MM
        const targetMonth = month || new Date().toISOString().slice(0, 7);

        const salesQuery = `
            SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
            (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN installments i ON s.sale_id = i.sale_id
            WHERE strftime('%Y-%m', s.sale_date, 'localtime') = ? AND s.is_deleted = 0
            ORDER BY s.sale_id DESC
        `;

        dbModule.db.all(salesQuery, [targetMonth], (err, salesRows) => {
            if (err) return reject({ success: false, message: err.message });

            // Query 2: Installment payments received in this month
            const paymentsQuery = `
                SELECT 
                    s.sale_id as sale_id,
                    s.customer_id as customer_id,
                    s.walkin_id as walkin_id,
                    ip.payment_date as sale_date,
                    ip.amount_paid as total_amount,
                    'Installment Payment' as payment_type,
                    COALESCE(c.full_name, s.walkin_name) as customer_name,
                    c.id_number,
                    0 as return_count,
                    ip.amount_paid as down_payment,
                    (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE strftime('%Y-%m', ip.payment_date, 'localtime') = ? AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            dbModule.db.all(paymentsQuery, [targetMonth], (err, paymentRows) => {
                if (err) return reject({ success: false, message: err.message });

                // Combine and sort
                const combined = [...(salesRows || []), ...(paymentRows || [])];
                combined.sort((a, b) => b.sale_id - a.sale_id);
                resolve({ success: true, sales: combined, month: targetMonth });
            });
        });
    });
});

ipcMain.handle('get-sales-report-by-date-range', async (event, params) => {
    return new Promise((resolve) => {
        try {
            const startDate = params && params.startDate;
            const endDate = params && params.endDate;

            if (!startDate || !endDate) {
                return resolve({ success: false, message: 'Start date and end date are required' });
            }

            const salesQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
                (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE(s.sale_date, 'localtime') BETWEEN DATE(?, 'localtime') AND DATE(?, 'localtime') AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            dbModule.db.all(salesQuery, [startDate, endDate], (err, salesRows) => {
                if (err) {
                    console.error('Date range report error:', err);
                    return resolve({ success: false, message: err.message });
                }

                const paymentsQuery = `
                    SELECT 
                        s.sale_id as sale_id,
                        s.customer_id as customer_id,
                        s.walkin_id as walkin_id,
                        ip.payment_date as sale_date,
                        ip.amount_paid as total_amount,
                        'Installment Payment' as payment_type,
                        COALESCE(c.full_name, s.walkin_name) as customer_name,
                        c.id_number,
                        0 as return_count,
                        ip.amount_paid as down_payment,
                        (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                    FROM installment_payments ip
                    JOIN installments i ON ip.installment_id = i.installment_id
                    JOIN sales s ON i.sale_id = s.sale_id
                    LEFT JOIN customers c ON s.customer_id = c.customer_id
                    WHERE DATE(ip.payment_date, 'localtime') BETWEEN DATE(?, 'localtime') AND DATE(?, 'localtime') AND s.is_deleted = 0
                    ORDER BY s.sale_id DESC
                `;

                dbModule.db.all(paymentsQuery, [startDate, endDate], (err, paymentRows) => {
                    if (err) {
                        console.error('Date range report error:', err);
                        return resolve({ success: false, message: err.message });
                    }

                    const combined = [...(salesRows || []), ...(paymentRows || [])];
                    combined.sort((a, b) => b.sale_id - a.sale_id);
                    resolve({ success: true, sales: combined, startDate, endDate });
                });
            });
        } catch (error) {
            console.error('Date range report exception:', error);
            resolve({ success: false, message: error.message });
        }
    });
});

ipcMain.handle('get-installment-report', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT i.*, c.full_name as customer_name, c.id_number, c.phone,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
            FROM installments i
            JOIN sales s ON i.sale_id = s.sale_id
            JOIN customers c ON s.customer_id = c.customer_id
            WHERE i.status IN ('Active', 'Overdue') AND s.is_deleted = 0
            ORDER BY i.installment_id DESC
        `;

        dbModule.db.all(query, (err, rows) => {
            if (err) return reject({ success: false, message: err.message });
            resolve({ success: true, installments: rows });
        });
    });
});

ipcMain.handle('get-overdue-report', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT i.*, c.full_name as customer_name, c.id_number, c.phone, c.address
            FROM installments i
            JOIN sales s ON i.sale_id = s.sale_id
            JOIN customers c ON s.customer_id = c.customer_id
            WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now'))) AND s.is_deleted = 0
            ORDER BY i.installment_id DESC
        `;

        dbModule.db.all(query, (err, rows) => {
            if (err) return reject({ success: false, message: err.message });
            resolve({ success: true, installments: rows });
        });
    });
});

ipcMain.handle('get-inventory-report', async () => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM products ORDER BY category, name`;

        dbModule.db.all(query, (err, rows) => {
            if (err) return reject({ success: false, message: err.message });

            const totalValue = rows.reduce((sum, p) => sum + (p.purchase_price * p.stock_qty), 0);
            const totalStock = rows.reduce((sum, p) => sum + p.stock_qty, 0);

            resolve({
                success: true,
                products: rows,
                summary: { totalValue, totalStock }
            });
        });
    });
});

ipcMain.handle('get-profit-loss-report', async (event, { startDate, endDate }) => {
    return new Promise((resolve, reject) => {
        // Query to get the total Cost of Goods Sold and Total Revenue per sale
        let query = `
            SELECT 
                s.sale_id,
                COALESCE(i.total_amount, s.total_amount) as final_revenue,
                SUM(COALESCE(si.purchase_price, 0) * (si.quantity - COALESCE(si.returned_qty, 0))) as total_cost
            FROM sales s
            JOIN sale_items si ON s.sale_id = si.sale_id
            LEFT JOIN installments i ON s.sale_id = i.sale_id
        `;

        const params = [];
        if (startDate && endDate) {
            query += ` WHERE DATE(s.sale_date) BETWEEN DATE(?) AND DATE(?) AND s.is_deleted = 0`;
            params.push(startDate, endDate);
        } else {
            query += ` WHERE s.is_deleted = 0`;
        }

        query += ` GROUP BY s.sale_id`;

        dbModule.db.all(query, params, (err, rows) => {
            if (err) return reject({ success: false, message: err.message });

            const report = rows.reduce((acc, row) => {
                acc.revenue += row.final_revenue;
                acc.cost += row.total_cost;
                return acc;
            }, { revenue: 0, cost: 0 });

            resolve({
                success: true,
                revenue: report.revenue,
                cost: report.cost,
                profit: report.revenue - report.cost,
                period: { startDate, endDate }
            });
        });
    });
});


// ═══════════════════════════════════════════════════════════
// UTILITY HANDLERS
// ═══════════════════════════════════════════════════════════

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

                // Get database instance safely
                const currentDb = dbModule.db;

                if (currentDb) {
                    currentDb.close((err) => {
                        if (err) {
                            return reject({ success: false, message: 'Could not close database connection' });
                        }

                        // Create backup
                        fs.copyFile(dbPath, backupPath, (err) => {
                            if (err) {
                                console.warn('Backup failed:', err);
                            }

                            // Replace database
                            fs.copyFile(sourcePath, dbPath, (err) => {
                                if (err) {
                                    // Try to restore backup if copy fails
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

console.log('Main process initialized successfully');
