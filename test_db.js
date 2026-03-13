const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const appDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
const dbPath = path.join(appDataPath, 'esms', 'esms.db');

console.log('Using DB at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }

    db.all(`
        SELECT 
            s.sale_id,
            s.payment_type,
            (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names,
            (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.sale_id) as item_count 
        FROM sales s 
        ORDER BY sale_id DESC 
        LIMIT 10;
    `, [], (err, rows) => {
        if (err) {
            console.error('Error executing query', err.message);
            return;
        }
        console.log(rows);
    });
});
