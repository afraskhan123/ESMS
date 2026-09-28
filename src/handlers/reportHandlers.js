function registerReportHandlers(context) {
    const { ipcMain, dbModule } = context;

    ipcMain.handle('get-daily-sales-report', async (event, date) => {
        try {
            const targetDate = date || new Date().toISOString().split('T')[0];

            const salesQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
                (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE(s.sale_date) = DATE(?) AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

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
                    (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE DATE(ip.payment_date) = DATE(?) AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            const [salesRows, paymentRows] = await Promise.all([
                dbModule.dbAll(salesQuery, [targetDate]),
                dbModule.dbAll(paymentsQuery, [targetDate])
            ]);

            const combined = [...(salesRows || []), ...(paymentRows || [])];
            combined.sort((a, b) => b.sale_id - a.sale_id);
            return { success: true, sales: combined, date: targetDate };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-monthly-sales-report', async (event, month) => {
        try {
            const targetMonth = month || new Date().toISOString().slice(0, 7);

            const salesQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
                (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE_FORMAT(s.sale_date, '%Y-%m') = ? AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

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
                    (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE DATE_FORMAT(ip.payment_date, '%Y-%m') = ? AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            const [salesRows, paymentRows] = await Promise.all([
                dbModule.dbAll(salesQuery, [targetMonth]),
                dbModule.dbAll(paymentsQuery, [targetMonth])
            ]);

            const combined = [...(salesRows || []), ...(paymentRows || [])];
            combined.sort((a, b) => b.sale_id - a.sale_id);
            return { success: true, sales: combined, month: targetMonth };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-sales-report-by-date-range', async (event, params) => {
        try {
            const startDate = params && params.startDate;
            const endDate = params && params.endDate;

            if (!startDate || !endDate) {
                return { success: false, message: 'Start date and end date are required' };
            }

            const salesQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, c.id_number, i.down_payment,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count,
                (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE(s.sale_date) BETWEEN DATE(?) AND DATE(?) AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

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
                    (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE DATE(ip.payment_date) BETWEEN DATE(?) AND DATE(?) AND s.is_deleted = 0
                ORDER BY s.sale_id DESC
            `;

            const [salesRows, paymentRows] = await Promise.all([
                dbModule.dbAll(salesQuery, [startDate, endDate]),
                dbModule.dbAll(paymentsQuery, [startDate, endDate])
            ]);

            const combined = [...(salesRows || []), ...(paymentRows || [])];
            combined.sort((a, b) => b.sale_id - a.sale_id);
            return { success: true, sales: combined, startDate, endDate };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-installment-report', async () => {
        try {
            const query = `
                SELECT i.*, c.full_name as customer_name, c.id_number, c.phone,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                JOIN customers c ON s.customer_id = c.customer_id
                WHERE i.status IN ('Active', 'Overdue') AND s.is_deleted = 0 AND i.is_deleted = 0
                ORDER BY i.installment_id DESC
            `;
            const rows = await dbModule.dbAll(query);
            return { success: true, installments: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-overdue-report', async () => {
        try {
            const query = `
                SELECT i.*, c.full_name as customer_name, c.id_number, c.phone, c.address
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                JOIN customers c ON s.customer_id = c.customer_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND i.next_due_date < CURDATE())) AND s.is_deleted = 0 AND i.is_deleted = 0
                ORDER BY i.installment_id DESC
            `;
            const rows = await dbModule.dbAll(query);
            return { success: true, installments: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-inventory-report', async () => {
        try {
            const query = `SELECT * FROM products ORDER BY category, name`;
            const rows = await dbModule.dbAll(query);

            const totalValue = rows.reduce((sum, p) => sum + (Number(p.purchase_price || 0) * Number(p.stock_qty || 0)), 0);
            const totalStock = rows.reduce((sum, p) => sum + Number(p.stock_qty || 0), 0);

            return {
                success: true,
                products: rows,
                summary: { totalValue, totalStock }
            };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-profit-loss-report', async (event, { startDate, endDate }) => {
        try {
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

            query += ` GROUP BY s.sale_id, i.total_amount, s.total_amount`;

            const rows = await dbModule.dbAll(query, params);

            const report = rows.reduce((acc, row) => {
                acc.revenue += Number(row.final_revenue || 0);
                acc.cost += Number(row.total_cost || 0);
                return acc;
            }, { revenue: 0, cost: 0 });

            return {
                success: true,
                revenue: report.revenue,
                cost: report.cost,
                profit: report.revenue - report.cost,
                period: { startDate, endDate }
            };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerReportHandlers;
