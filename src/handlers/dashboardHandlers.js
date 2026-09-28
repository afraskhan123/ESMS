function registerDashboardHandlers(context) {
    const { ipcMain, dbModule } = context;

    ipcMain.handle('get-dashboard-stats', async () => {
        try {
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
                    WHERE DATE(s.sale_date) = CURDATE() AND s.is_deleted = 0
                ) + (
                    SELECT COALESCE(SUM(ip.amount_paid), 0)
                    FROM installment_payments ip
                    JOIN installments i ON ip.installment_id = i.installment_id
                    JOIN sales s ON i.sale_id = s.sale_id
                    WHERE DATE(ip.payment_date) = CURDATE() AND s.is_deleted = 0
                ) as total
            `;
            const dailyRow = await dbModule.dbGet(dailyQuery);
            stats.daily_sales = dailyRow ? dailyRow.total : 0;

            const monthlyQuery = `
                SELECT (
                    SELECT COALESCE(SUM(
                        CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                             WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                             ELSE 0 END
                    ), 0)
                    FROM sales s
                    LEFT JOIN installments i ON s.sale_id = i.sale_id
                    WHERE DATE_FORMAT(s.sale_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') AND s.is_deleted = 0
                ) + (
                    SELECT COALESCE(SUM(ip.amount_paid), 0)
                    FROM installment_payments ip
                    JOIN installments i ON ip.installment_id = i.installment_id
                    JOIN sales s ON i.sale_id = s.sale_id
                    WHERE DATE_FORMAT(ip.payment_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') AND s.is_deleted = 0
                ) as total
            `;
            const monthlyRow = await dbModule.dbGet(monthlyQuery);
            stats.monthly_sales = monthlyRow ? monthlyRow.total : 0;

            const pendingRow = await dbModule.dbGet(`
                SELECT COALESCE(SUM(remaining_balance), 0) as total 
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                WHERE i.status IN ('Active', 'Overdue') AND s.is_deleted = 0 AND i.is_deleted = 0
            `);
            stats.pending_installments = pendingRow ? pendingRow.total : 0;

            const overdueRow = await dbModule.dbGet(`
                SELECT COUNT(*) as count 
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND i.next_due_date < CURDATE())) AND s.is_deleted = 0 AND i.is_deleted = 0
            `);
            stats.overdue_count = overdueRow ? overdueRow.count : 0;

            const lowStockRow = await dbModule.dbGet(`SELECT COUNT(*) as count FROM products WHERE stock_qty < min_stock_level`);
            stats.low_stock_count = lowStockRow ? lowStockRow.count : 0;

            const customerRow = await dbModule.dbGet(`SELECT COUNT(*) as count FROM customers WHERE is_deleted = 0`);
            stats.total_customers = customerRow ? customerRow.count : 0;

            return { success: true, stats };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-dashboard-alerts', async () => {
        try {
            const alerts = [];

            const products = await dbModule.dbAll('SELECT * FROM products WHERE stock_qty < min_stock_level');
            products.forEach(p => {
                alerts.push({
                    severity: 'warning',
                    title: 'Low Stock Alert',
                    message: `${p.name} is running low (${p.stock_qty} remaining)`,
                    type: 'low-stock',
                    target: 'inventory'
                });
            });

            const overdueInstallments = await dbModule.dbAll(`
                SELECT i.*, COALESCE(c.full_name, s.walkin_name) as full_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND i.next_due_date < CURDATE())) AND s.is_deleted = 0 AND i.is_deleted = 0
            `);
            overdueInstallments.forEach(inst => {
                alerts.push({
                    severity: 'danger',
                    title: 'Overdue Payment',
                    message: `${inst.full_name || 'Customer'} has an overdue payment of Rs. ${inst.monthly_amount}`,
                    type: 'overdue',
                    target: 'installments'
                });
            });

            const dueToday = await dbModule.dbAll(`
                SELECT i.*, COALESCE(c.full_name, s.walkin_name) as full_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE i.status = 'Active' AND i.next_due_date = CURDATE() AND s.is_deleted = 0 AND i.is_deleted = 0
            `);
            dueToday.forEach(inst => {
                alerts.push({
                    severity: 'warning',
                    title: 'Payment Due Today',
                    message: `${inst.full_name || 'Customer'} has a payment of Rs. ${inst.monthly_amount} due today`,
                    type: 'due-today',
                    target: 'installments'
                });
            });

            return { success: true, alerts };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerDashboardHandlers;
