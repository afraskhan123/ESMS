const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
let app = null;
try {
    const electron = require('electron');
    app = electron ? electron.app : null;
} catch (e) {
    app = null;
}

let pool = null;

// Default MySQL Configuration
const DEFAULT_CONFIG = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'afras7988',
    database: 'fridge_agency'
};

function getConfigFilePath() {
    try {
        if (app && app.getPath) {
            const userDataPath = app.getPath('userData');
            return path.join(userDataPath, 'db_config.json');
        }
    } catch (e) { }
    return path.join(__dirname, 'db_config.json');
}

function getDbConfig() {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
        } catch (e) {
            console.error('Error reading db_config.json, using defaults:', e.message);
        }
    }
    return { ...DEFAULT_CONFIG };
}

function saveDbConfig(newConfig) {
    const configPath = getConfigFilePath();
    try {
        const configToSave = { ...getDbConfig(), ...newConfig };
        fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');
        return { success: true, config: configToSave };
    } catch (e) {
        console.error('Error saving db_config.json:', e.message);
        return { success: false, message: e.message };
    }
}

async function testConnection(config) {
    let testConn = null;
    try {
        const cfg = config || getDbConfig();
        testConn = await mysql.createConnection({
            host: cfg.host,
            port: Number(cfg.port) || 3306,
            user: cfg.user,
            password: cfg.password,
            connectTimeout: 5000
        });
        await testConn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await testConn.end();
        return { success: true, message: 'Connection successful!' };
    } catch (err) {
        if (testConn) {
            try { await testConn.end(); } catch (e) { }
        }
        return { success: false, message: err.message };
    }
}

// Helper functions for queries with pool
const dbGet = async (sql, params = []) => {
    if (!pool) throw new Error('Database pool not initialized');
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
};

const dbAll = async (sql, params = []) => {
    if (!pool) throw new Error('Database pool not initialized');
    const [rows] = await pool.query(sql, params);
    return rows || [];
};

const dbRun = async (sql, params = []) => {
    if (!pool) throw new Error('Database pool not initialized');
    const [result] = await pool.query(sql, params);
    return {
        lastID: result ? result.insertId : null,
        insertId: result ? result.insertId : null,
        changes: result ? result.affectedRows : 0,
        affectedRows: result ? result.affectedRows : 0
    };
};

// Transaction Helper
async function withTransaction(callback) {
    if (!pool) throw new Error('Database pool not initialized');
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Wrap conn query helper methods for convenience inside transactions
        conn.dbGet = async (sql, params = []) => {
            const [rows] = await conn.query(sql, params);
            return rows && rows.length > 0 ? rows[0] : null;
        };
        conn.dbAll = async (sql, params = []) => {
            const [rows] = await conn.query(sql, params);
            return rows || [];
        };
        conn.dbRun = async (sql, params = []) => {
            const [result] = await conn.query(sql, params);
            return {
                lastID: result ? result.insertId : null,
                insertId: result ? result.insertId : null,
                changes: result ? result.affectedRows : 0,
                affectedRows: result ? result.affectedRows : 0
            };
        };

        const result = await callback(conn);
        await conn.commit();
        return result;
    } catch (error) {
        try { await conn.rollback(); } catch (e) { }
        throw error;
    } finally {
        conn.release();
    }
}

// SQLite callback-style compatibility wrapper (ensures legacy/callback calls work seamlessly)
const dbCompatibility = {
    get: (sql, params, callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        dbGet(sql, params)
            .then(row => callback && callback(null, row))
            .catch(err => callback && callback(err, null));
    },
    all: (sql, params, callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        dbAll(sql, params)
            .then(rows => callback && callback(null, rows))
            .catch(err => callback && callback(err, []));
    },
    run: (sql, params, callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        dbRun(sql, params)
            .then(res => {
                if (callback) {
                    callback.call(res, null);
                }
            })
            .catch(err => callback && callback(err));
    },
    serialize: (fn) => {
        if (typeof fn === 'function') fn();
    }
};

// Initialize database and connection pool
async function initializeDatabase() {
    const config = getDbConfig();
    console.log(`Connecting to MySQL at ${config.host}:${config.port}, database: ${config.database}...`);

    // 1. Ensure database exists
    let initConn;
    try {
        initConn = await mysql.createConnection({
            host: config.host,
            port: Number(config.port) || 3306,
            user: config.user,
            password: config.password,
            connectTimeout: 7000
        });
        await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await initConn.end();
    } catch (e) {
        if (initConn) {
            try { await initConn.end(); } catch (_) { }
        }
        console.error('MySQL database creation/check warning:', e.message);
    }

    // 2. Create Connection Pool
    if (pool) {
        try { await pool.end(); } catch (e) { }
    }

    pool = mysql.createPool({
        host: config.host,
        port: Number(config.port) || 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
        dateStrings: true
    });

    // Test pool connection
    const connection = await pool.getConnection();
    connection.release();
    console.log('✓ Connected to MySQL database pool successfully!');

    // 3. Create tables & defaults
    await createTables();
    console.log('✓ MySQL Database schema initialized successfully!');

    return pool;
}

// Create all tables
async function createTables() {
    // 1. Admin Table
    await dbRun(`CREATE TABLE IF NOT EXISTS admin (
        admin_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        profile_image LONGTEXT,
        recovery_code VARCHAR(255)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Check/Create default admin
    const admin = await dbGet('SELECT * FROM admin WHERE username = ?', ['admin']);
    if (!admin) {
        const hashedPassword = hashPassword('admin123');
        const hashedRecoveryCode = hashPassword('123456');
        await dbRun('INSERT INTO admin (username, password, recovery_code) VALUES (?, ?, ?)',
            ['admin', hashedPassword, hashedRecoveryCode]);
        console.log('✓ Default admin created (username: admin)');
    }

    // 2. Products Table
    await dbRun(`CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        brand VARCHAR(100),
        purchase_price DECIMAL(12, 2) NOT NULL,
        selling_price DECIMAL(12, 2) NOT NULL,
        stock_qty INT DEFAULT 0,
        min_stock_level INT DEFAULT 5,
        supplier_name VARCHAR(255),
        warranty_period VARCHAR(100),
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_products_category (category),
        INDEX idx_products_brand (brand)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 3. Customers Table
    await dbRun(`CREATE TABLE IF NOT EXISTS customers (
        customer_id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        address TEXT,
        id_number VARCHAR(100),
        email VARCHAR(150),
        image_path LONGTEXT,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted TINYINT(1) DEFAULT 0,
        INDEX idx_customers_phone (phone),
        INDEX idx_customers_id_number (id_number),
        INDEX idx_customers_deleted (is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 4. Sales Table
    await dbRun(`CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NULL,
        walkin_name VARCHAR(255),
        walkin_id INT,
        sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_amount DECIMAL(12, 2) NOT NULL,
        payment_type ENUM('Cash', 'Installment') NOT NULL,
        status VARCHAR(50) DEFAULT 'Completed',
        is_hidden TINYINT(1) DEFAULT 0,
        is_deleted TINYINT(1) DEFAULT 0,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
        INDEX idx_sales_customer (customer_id),
        INDEX idx_sales_date (sale_date),
        INDEX idx_sales_deleted (is_deleted),
        INDEX idx_sales_hidden (is_hidden)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 5. Sale Items Table
    await dbRun(`CREATE TABLE IF NOT EXISTS sale_items (
        sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        product_id INT NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(12, 2) NOT NULL,
        subtotal DECIMAL(12, 2) NOT NULL,
        purchase_price DECIMAL(12, 2) DEFAULT 0.00,
        returned_qty INT DEFAULT 0,
        FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL,
        INDEX idx_sale_items_sale (sale_id),
        INDEX idx_sale_items_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 6. Installments Table
    await dbRun(`CREATE TABLE IF NOT EXISTS installments (
        installment_id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        down_payment DECIMAL(12, 2) DEFAULT 0.00,
        total_amount DECIMAL(12, 2) NOT NULL,
        remaining_balance DECIMAL(12, 2) NOT NULL,
        monthly_amount DECIMAL(12, 2) NOT NULL,
        installment_duration INT NOT NULL,
        next_due_date DATE NOT NULL,
        status ENUM('Active', 'Completed', 'Overdue') DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        guarantor_name VARCHAR(255),
        guarantor_cnic VARCHAR(100),
        guarantor_mobile VARCHAR(50),
        guarantor_address TEXT,
        is_deleted TINYINT(1) DEFAULT 0,
        FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
        INDEX idx_installments_sale (sale_id),
        INDEX idx_installments_status (status),
        INDEX idx_installments_due_date (next_due_date),
        INDEX idx_installments_deleted (is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 7. Installment Payments Table
    await dbRun(`CREATE TABLE IF NOT EXISTS installment_payments (
        payment_id INT AUTO_INCREMENT PRIMARY KEY,
        installment_id INT NOT NULL,
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        amount_paid DECIMAL(12, 2) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Cash',
        remaining_balance_after DECIMAL(12, 2) NOT NULL,
        FOREIGN KEY (installment_id) REFERENCES installments(installment_id) ON DELETE CASCADE,
        INDEX idx_payments_installment (installment_id),
        INDEX idx_payments_date (payment_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 8. Activity Logs Table
    await dbRun(`CREATE TABLE IF NOT EXISTS activity_logs (
        log_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_logs_timestamp (timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// Helper function to hash passwords
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Getter function for database pool
function getDatabase() {
    return dbCompatibility;
}

function getPool() {
    return pool;
}

// Log user activity
async function logActivity(username, action, details) {
    if (!pool) return;
    try {
        const sql = 'INSERT INTO activity_logs (username, action, details) VALUES (?, ?, ?)';
        await dbRun(sql, [username, action, details]);

        // Automatic cleanup: Keep latest 3000 logs
        if (Math.random() < 0.1) {
            await dbRun(`
                DELETE FROM activity_logs 
                WHERE log_id NOT IN (
                    SELECT log_id FROM (
                        SELECT log_id FROM activity_logs 
                        ORDER BY log_id DESC LIMIT 3000
                    ) AS recent_logs
                )
            `);
        }
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
}

module.exports = {
    getDatabase,
    getPool,
    initializeDatabase,
    hashPassword,
    logActivity,
    dbGet,
    dbAll,
    dbRun,
    withTransaction,
    getDbConfig,
    saveDbConfig,
    testConnection,
    get db() {
        return dbCompatibility;
    }
};
