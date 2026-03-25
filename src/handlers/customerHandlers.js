const fs = require('fs');
const path = require('path');

function registerCustomerHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser, app } = context;

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
                        dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Add Customer', `Added customer: ${fullName}. CNIC: ${idNumber || 'N/A'} (ID: ${this.lastID})`);
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
                            dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Update Customer', `Updated customer: ${fullName} (ID: ${customer_id}). New CNIC: ${idNumber || 'N/A'}`);
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
                    dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Delete Customer', `Deleted customer ID: ${customer_id}`);
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
}

module.exports = registerCustomerHandlers;
