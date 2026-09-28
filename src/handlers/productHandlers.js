function registerProductHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser } = context;

    ipcMain.handle('get-all-products', async (event, filters = {}) => {
        try {
            let query = 'SELECT * FROM products';
            const params = [];

            if (filters.category) {
                query += ' WHERE category = ?';
                params.push(filters.category);
            } else if (filters.lowStock) {
                query += ' WHERE stock_qty < min_stock_level';
            }

            query += ' ORDER BY product_id DESC';

            const rows = await dbModule.dbAll(query, params);
            return { success: true, products: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('add-product', async (event, product) => {
        try {
            const { name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period } = product;

            if (purchase_price < 0 || selling_price < 0 || stock_qty < 0 || min_stock_level < 0) {
                return { success: false, message: 'Product values cannot be negative' };
            }

            const result = await dbModule.dbRun(
                `INSERT INTO products (name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period]
            );

            const newId = result.insertId;
            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Add Product',
                `Added product: ${name}. Category: ${category || 'N/A'}, Price: Rs. ${selling_price}, Initial Stock: ${stock_qty} (ID: ${newId})`
            );

            return { success: true, message: 'Product added successfully', product_id: newId };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('update-product', async (event, product) => {
        try {
            const { product_id, name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period } = product;

            if (purchase_price < 0 || selling_price < 0 || stock_qty < 0 || min_stock_level < 0) {
                return { success: false, message: 'Product values cannot be negative' };
            }

            await dbModule.dbRun(
                `UPDATE products SET name = ?, category = ?, brand = ?, purchase_price = ?, selling_price = ?,
                 stock_qty = ?, min_stock_level = ?, supplier_name = ?, warranty_period = ? WHERE product_id = ?`,
                [name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period, product_id]
            );

            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Update Product',
                `Updated product: ${name} (ID: ${product_id}). New Price: Rs. ${selling_price}, New Stock: ${stock_qty}`
            );

            return { success: true, message: 'Product updated successfully' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('delete-product', async (event, product_id) => {
        try {
            await dbModule.dbRun('DELETE FROM products WHERE product_id = ?', [product_id]);
            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Delete Product',
                `Deleted product ID: ${product_id}`
            );
            return { success: true, message: 'Product deleted successfully' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('search-products', async (event, searchTerm) => {
        try {
            const query = 'SELECT * FROM products WHERE name LIKE ? OR category LIKE ? OR brand LIKE ? ORDER BY product_id DESC';
            const term = `%${searchTerm}%`;
            const rows = await dbModule.dbAll(query, [term, term, term]);
            return { success: true, products: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-low-stock-products', async () => {
        try {
            const rows = await dbModule.dbAll('SELECT * FROM products WHERE stock_qty < min_stock_level');
            return { success: true, products: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerProductHandlers;
