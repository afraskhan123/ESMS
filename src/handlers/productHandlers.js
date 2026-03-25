function registerProductHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser } = context;

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
                        dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Add Product', `Added product: ${name}. Category: ${category || 'N/A'}, Price: Rs. ${selling_price}, Initial Stock: ${stock_qty} (ID: ${this.lastID})`);
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
                    dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Update Product', `Updated product: ${name} (ID: ${product_id}). New Price: Rs. ${selling_price}, New Stock: ${stock_qty}`);
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
                    dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Delete Product', `Deleted product ID: ${product_id}`);
                    resolve({ success: true, message: 'Product deleted successfully' });
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
}

module.exports = registerProductHandlers;
