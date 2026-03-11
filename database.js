const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { app } = require('electron');

// IMPORTANT: Use userData so the database is stored in a writable location
// when the app is installed as a .exe. __dirname points inside a read-only
// ASAR archive in production builds.
function getDbPath() {
    const userDataPath = app.getPath('userData');
    const dbFile = path.join(userDataPath, 'esms.db');

    // On first run, copy the bundled seed DB so the default admin user is available.
    // In production (.exe), electron-builder places extraResources at process.resourcesPath.
    // In development, fall back to __dirname.
    if (!fs.existsSync(dbFile)) {
        const bundledDb = app.isPackaged
            ? path.join(process.resourcesPath, 'esms.db')
            : path.join(__dirname, 'esms.db');
        if (fs.existsSync(bundledDb)) {
            try {
                fs.copyFileSync(bundledDb, dbFile);
                console.log('Copied bundled esms.db to userData:', dbFile);
            } catch (e) {
                console.error('Could not copy bundled DB:', e.message);
            }
        }
    }

    return dbFile;
}

let db = null;

// Helper functions to use Promises with sqlite3
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

// Initialize database connection
async function initializeDatabase() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const dbPath = getDbPath();
        db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                console.error('Error opening database ' + dbPath + ': ' + err.message);
                reject(err);
            } else {
                try {
                    console.log('Connected to the SQLite database at: ' + dbPath);
                    await dbRun('PRAGMA foreign_keys = ON');
                    await createTables();
                    console.log('✓ Database initialization complete!');
                    resolve(db);
                } catch (error) {
                    console.error('Database initialization error:', error);
                    reject(error);
                }
            }
        });
    });
}

// Create all tables and run migrations sequentially
async function createTables() {
    // 1. Admin Table
    await dbRun(`CREATE TABLE IF NOT EXISTS admin (
        admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        profile_image TEXT,
        recovery_code TEXT
    )`);

    // Check and add missing columns for admin
    const adminCols = await dbAll("PRAGMA table_info(admin)");
    if (!adminCols.some(c => c.name === 'profile_image')) {
        await dbRun("ALTER TABLE admin ADD COLUMN profile_image TEXT");
    }
    if (!adminCols.some(c => c.name === 'recovery_code')) {
        await dbRun("ALTER TABLE admin ADD COLUMN recovery_code TEXT");
        const defaultRecoveryCode = hashPassword('123456');
        await dbRun("UPDATE admin SET recovery_code = ? WHERE recovery_code IS NULL", [defaultRecoveryCode]);
    }

    // Check/Create default admin
    const admin = await dbGet('SELECT * FROM admin WHERE username = ?', ['admin']);
    if (!admin) {
        const hashedPassword = hashPassword('admin123');
        const hashedRecoveryCode = hashPassword('123456');
        await dbRun('INSERT INTO admin (username, password, recovery_code) VALUES (?, ?, ?)',
            ['admin', hashedPassword, hashedRecoveryCode]);
        console.log('✓ Default admin created');
    }

    // 2. Products Table
    await dbRun(`CREATE TABLE IF NOT EXISTS products (
        product_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        brand TEXT,
        purchase_price REAL NOT NULL,
        selling_price REAL NOT NULL,
        stock_qty INTEGER DEFAULT 0,
        min_stock_level INTEGER DEFAULT 5,
        supplier_name TEXT,
        warranty_period TEXT,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. Customers Table
    await dbRun(`CREATE TABLE IF NOT EXISTS customers (
        customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT,
        id_number TEXT,
        email TEXT,
        image_path TEXT,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0
    )`);
    const customerCols = await dbAll("PRAGMA table_info(customers)");
    if (!customerCols.some(c => c.name === 'is_deleted')) {
        await dbRun("ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0");
    }
    if (!customerCols.some(c => c.name === 'image_path')) {
        await dbRun("ALTER TABLE customers ADD COLUMN image_path TEXT");
    }

    // 4. Sales Table
    await dbRun(`CREATE TABLE IF NOT EXISTS sales (
        sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        walkin_name TEXT,
        sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_amount REAL NOT NULL,
        payment_type TEXT CHECK(payment_type IN ('Cash', 'Installment')) NOT NULL,
        status TEXT DEFAULT 'Completed',
        is_hidden INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
    )`);
    const salesCols = await dbAll("PRAGMA table_info(sales)");
    if (!salesCols.some(c => c.name === 'is_hidden')) {
        await dbRun("ALTER TABLE sales ADD COLUMN is_hidden INTEGER DEFAULT 0");
    }
    if (!salesCols.some(c => c.name === 'is_deleted')) {
        await dbRun("ALTER TABLE sales ADD COLUMN is_deleted INTEGER DEFAULT 0");
    }
    if (!salesCols.some(c => c.name === 'walkin_name')) {
        await dbRun("ALTER TABLE sales ADD COLUMN walkin_name TEXT");
    }

    // 5. Sale Items Table
    await dbRun(`CREATE TABLE IF NOT EXISTS sale_items (
        sale_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        subtotal REAL NOT NULL,
        purchase_price REAL DEFAULT 0,
        returned_qty INTEGER DEFAULT 0,
        FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
    )`);
    const siCols = await dbAll("PRAGMA table_info(sale_items)");
    if (!siCols.some(c => c.name === 'purchase_price')) {
        await dbRun("ALTER TABLE sale_items ADD COLUMN purchase_price REAL DEFAULT 0");
    }
    if (!siCols.some(c => c.name === 'returned_qty')) {
        await dbRun("ALTER TABLE sale_items ADD COLUMN returned_qty INTEGER DEFAULT 0");
    }
    // Backfill snapshot prices
    await dbRun(`UPDATE sale_items SET purchase_price = (
        SELECT p.purchase_price FROM products p WHERE p.product_id = sale_items.product_id
    ) WHERE purchase_price = 0 AND product_id IS NOT NULL`);

    // 6. Installments Table
    await dbRun(`CREATE TABLE IF NOT EXISTS installments (
        installment_id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        down_payment REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        remaining_balance REAL NOT NULL,
        monthly_amount REAL NOT NULL,
        installment_duration INTEGER NOT NULL,
        next_due_date DATE NOT NULL,
        status TEXT CHECK(status IN ('Active', 'Completed', 'Overdue')) DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        guarantor_name TEXT,
        guarantor_cnic TEXT,
        guarantor_mobile TEXT,
        guarantor_address TEXT,
        FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE
    )`);
    // Migrations for guarantor columns
    const installmentCols = await dbAll("PRAGMA table_info(installments)");
    if (!installmentCols.some(c => c.name === 'guarantor_name')) {
        await dbRun("ALTER TABLE installments ADD COLUMN guarantor_name TEXT");
    }
    if (!installmentCols.some(c => c.name === 'guarantor_cnic')) {
        await dbRun("ALTER TABLE installments ADD COLUMN guarantor_cnic TEXT");
    }
    if (!installmentCols.some(c => c.name === 'guarantor_mobile')) {
        await dbRun("ALTER TABLE installments ADD COLUMN guarantor_mobile TEXT");
    }
    if (!installmentCols.some(c => c.name === 'guarantor_address')) {
        await dbRun("ALTER TABLE installments ADD COLUMN guarantor_address TEXT");
    }

    // 7. Installment Payments Table
    await dbRun(`CREATE TABLE IF NOT EXISTS installment_payments (
        payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
        installment_id INTEGER NOT NULL,
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        amount_paid REAL NOT NULL,
        remaining_balance_after REAL NOT NULL,
        FOREIGN KEY (installment_id) REFERENCES installments(installment_id) ON DELETE CASCADE
    )`);

    // 8. Indexes
    await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_installments_sale ON installments(sale_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_installments_status ON installments(status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(next_due_date)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_payments_installment ON installment_payments(installment_id)');

    // Cleanup orphaned installment sales (where installment was deleted but sale remains)
    await dbRun(`UPDATE sales SET is_deleted = 1 WHERE payment_type = 'Installment' AND sale_id NOT IN (SELECT sale_id FROM installments)`);
}

// Helper function to hash passwords
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Getter function for database
function getDatabase() {
    return db;
}

// Export functions
module.exports = {
    getDatabase,
    initializeDatabase,
    hashPassword,
    get db() {
        return db;
    }
};
