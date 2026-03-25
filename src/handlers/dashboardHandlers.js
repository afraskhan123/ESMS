function registerDashboardHandlers(context) {
    const { ipcMain, dbModule } = context;

    ipcMain.handle('get-dashboard-stats', async () => {
        return new Promise((resolve, reject) => {
            const stats = {};

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

                    dbModule.db.get(`
                        SELECT COALESCE(SUM(remaining_balance), 0) as total 
                        FROM installments i
                        JOIN sales s ON i.sale_id = s.sale_id
                        WHERE i.status IN ('Active', 'Overdue') AND s.is_deleted = 0
                    `, (err, row) => {
                        if (err) return reject({ success: false, message: err.message });
                        stats.pending_installments = row.total;

                        dbModule.db.get(`
                            SELECT COUNT(*) as count 
                            FROM installments i
                            JOIN sales s ON i.sale_id = s.sale_id
                            WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now'))) AND s.is_deleted = 0
                        `, (err, row) => {
                            if (err) return reject({ success: false, message: err.message });
                            stats.overdue_count = row.count;

                                dbModule.db.get(`SELECT COUNT(*) as count FROM products WHERE stock_qty < min_stock_level`, (err, row) => {
                                    if (err) return reject({ success: false, message: err.message });
                                    stats.low_stock_count = row.count;

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
}

module.exports = registerDashboardHandlers;
