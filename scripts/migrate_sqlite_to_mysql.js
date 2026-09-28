const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const dbModule = require('../database');

async function migrateSqliteToMysql(sqliteFilePath) {
    const dbPath = sqliteFilePath || path.join(__dirname, '..', 'esms.db');
    if (!fs.existsSync(dbPath)) {
        console.error(`SQLite file not found at: ${dbPath}`);
        return { success: false, message: `SQLite file not found at ${dbPath}` };
    }

    console.log(`Starting migration from SQLite (${dbPath}) to MySQL...`);

    // 1. Open SQLite
    const sqliteDb = new sqlite3.Database(dbPath);
    const sqliteAll = (sql, params = []) => new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

    // 2. Initialize MySQL
    await dbModule.initializeDatabase();
    const pool = dbModule.getPool();

    try {
        // Migrate Admin
        const admins = await sqliteAll('SELECT * FROM admin');
        console.log(`Migrating ${admins.length} admin records...`);
        for (const a of admins) {
            await pool.query(
                `INSERT INTO admin (admin_id, username, password, created_at, profile_image, recovery_code)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE password = VALUES(password), profile_image = VALUES(profile_image), recovery_code = VALUES(recovery_code)`,
                [a.admin_id, a.username, a.password, a.created_at, a.profile_image, a.recovery_code]
            );
        }

        // Migrate Products
        const products = await sqliteAll('SELECT * FROM products');
        console.log(`Migrating ${products.length} products...`);
        for (const p of products) {
            await pool.query(
                `INSERT INTO products (product_id, name, category, brand, purchase_price, selling_price, stock_qty, min_stock_level, supplier_name, warranty_period, date_added, last_updated)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), brand = VALUES(brand),
                 purchase_price = VALUES(purchase_price), selling_price = VALUES(selling_price), stock_qty = VALUES(stock_qty),
                 min_stock_level = VALUES(min_stock_level), supplier_name = VALUES(supplier_name), warranty_period = VALUES(warranty_period)`,
                [p.product_id, p.name, p.category, p.brand, p.purchase_price, p.selling_price, p.stock_qty, p.min_stock_level, p.supplier_name, p.warranty_period, p.date_added, p.last_updated || p.date_added]
            );
        }

        // Migrate Customers
        const customers = await sqliteAll('SELECT * FROM customers');
        console.log(`Migrating ${customers.length} customers...`);
        for (const c of customers) {
            await pool.query(
                `INSERT INTO customers (customer_id, full_name, phone, address, id_number, email, image_path, date_added, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone = VALUES(phone), address = VALUES(address),
                 id_number = VALUES(id_number), email = VALUES(email), image_path = VALUES(image_path), is_deleted = VALUES(is_deleted)`,
                [c.customer_id, c.full_name, c.phone, c.address, c.id_number, c.email, c.image_path, c.date_added, c.is_deleted || 0]
            );
        }

        // Migrate Sales
        const sales = await sqliteAll('SELECT * FROM sales');
        console.log(`Migrating ${sales.length} sales...`);
        for (const s of sales) {
            await pool.query(
                `INSERT INTO sales (sale_id, customer_id, walkin_name, walkin_id, sale_date, total_amount, payment_type, status, is_hidden, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), status = VALUES(status), is_hidden = VALUES(is_hidden), is_deleted = VALUES(is_deleted)`,
                [s.sale_id, s.customer_id, s.walkin_name, s.walkin_id, s.sale_date, s.total_amount, s.payment_type, s.status || 'Completed', s.is_hidden || 0, s.is_deleted || 0]
            );
        }

        // Migrate Sale Items
        const saleItems = await sqliteAll('SELECT * FROM sale_items');
        console.log(`Migrating ${saleItems.length} sale items...`);
        for (const si of saleItems) {
            await pool.query(
                `INSERT INTO sale_items (sale_item_id, sale_id, product_id, product_name, quantity, unit_price, subtotal, purchase_price, returned_qty)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit_price = VALUES(unit_price), subtotal = VALUES(subtotal), returned_qty = VALUES(returned_qty)`,
                [si.sale_item_id, si.sale_id, si.product_id, si.product_name, si.quantity, si.unit_price, si.subtotal, si.purchase_price || 0, si.returned_qty || 0]
            );
        }

        // Migrate Installments
        const installments = await sqliteAll('SELECT * FROM installments');
        console.log(`Migrating ${installments.length} installments...`);
        for (const inst of installments) {
            await pool.query(
                `INSERT INTO installments (installment_id, sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date, status, created_at, guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE remaining_balance = VALUES(remaining_balance), status = VALUES(status), next_due_date = VALUES(next_due_date), is_deleted = VALUES(is_deleted)`,
                [inst.installment_id, inst.sale_id, inst.down_payment || 0, inst.total_amount, inst.remaining_balance, inst.monthly_amount, inst.installment_duration, inst.next_due_date, inst.status || 'Active', inst.created_at, inst.guarantor_name, inst.guarantor_cnic, inst.guarantor_mobile, inst.guarantor_address, inst.is_deleted || 0]
            );
        }

        // Migrate Installment Payments
        const payments = await sqliteAll('SELECT * FROM installment_payments');
        console.log(`Migrating ${payments.length} installment payments...`);
        for (const p of payments) {
            await pool.query(
                `INSERT INTO installment_payments (payment_id, installment_id, payment_date, amount_paid, payment_method, remaining_balance_after)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE amount_paid = VALUES(amount_paid), remaining_balance_after = VALUES(remaining_balance_after)`,
                [p.payment_id, p.installment_id, p.payment_date, p.amount_paid, p.payment_method || 'Cash', p.remaining_balance_after]
            );
        }

        // Migrate Activity Logs
        const logs = await sqliteAll('SELECT * FROM activity_logs');
        console.log(`Migrating ${logs.length} activity logs...`);
        for (const l of logs) {
            await pool.query(
                `INSERT INTO activity_logs (log_id, username, action, details, timestamp)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE action = VALUES(action), details = VALUES(details)`,
                [l.log_id, l.username, l.action, l.details, l.timestamp]
            );
        }

        console.log('✓ SQLite to MySQL migration completed successfully!');
        return { success: true, message: 'Migration completed successfully!' };
    } catch (err) {
        console.error('Migration error:', err);
        return { success: false, message: err.message };
    } finally {
        sqliteDb.close();
    }
}

if (require.main === module) {
    const targetFile = process.argv[2];
    migrateSqliteToMysql(targetFile)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { migrateSqliteToMysql };
