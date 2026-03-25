function registerReportHandlers(context) {
    const { ipcMain, dbModule } = context;

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

                    const combined = [...(salesRows || []), ...(paymentRows || [])];
                    combined.sort((a, b) => b.sale_id - a.sale_id);
                    resolve({ success: true, sales: combined, date: targetDate });
                });
            });
        });
    });

    ipcMain.handle('get-monthly-sales-report', async (event, month) => {
        return new Promise((resolve, reject) => {
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
}

module.exports = registerReportHandlers;
