function registerInstallmentHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser } = context;

    ipcMain.handle('get-all-installments', async (event, filters = {}) => {
        try {
            // First, update status based on next_due_date
            await dbModule.dbRun(`
                UPDATE installments 
                SET status = 'Overdue' 
                WHERE status = 'Active' AND next_due_date < CURDATE() AND is_deleted = 0
            `);

            await dbModule.dbRun(`
                UPDATE installments 
                SET status = 'Active' 
                WHERE status = 'Overdue' AND next_due_date >= CURDATE() AND is_deleted = 0
            `);

            // Fetch filtered results
            let query = `
                SELECT i.*, c.full_name as customer_name, c.id_number, s.sale_date,
                (SELECT GROUP_CONCAT(product_name SEPARATOR ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.is_deleted = 0 AND i.is_deleted = 0
            `;
            const params = [];

            if (filters.status === 'Overdue') {
                query += " AND (i.status = 'Overdue' OR (i.status = 'Active' AND i.next_due_date < CURDATE()))";
            } else if (filters.status === 'Active') {
                query += " AND i.status = 'Active' AND i.next_due_date >= CURDATE()";
            } else if (filters.status) {
                query += ' AND i.status = ?';
                params.push(filters.status);
            }

            query += ' ORDER BY i.installment_id DESC';

            const rows = await dbModule.dbAll(query, params);
            return { success: true, installments: rows };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-due-installments', async () => {
        try {
            const query = `
                SELECT i.*, c.full_name as customer_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE i.status IN ('Active', 'Overdue') AND i.next_due_date <= CURDATE() AND s.is_deleted = 0 AND i.is_deleted = 0
                ORDER BY i.next_due_date ASC
            `;
            const rows = await dbModule.dbAll(query);
            return { success: true, installments: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-overdue-installments', async () => {
        try {
            const query = `
                SELECT i.*, c.full_name as customer_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND i.next_due_date < CURDATE())) AND s.is_deleted = 0 AND i.is_deleted = 0
                ORDER BY i.next_due_date ASC
            `;
            const rows = await dbModule.dbAll(query);
            return { success: true, installments: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('record-installment-payment', async (event, paymentData) => {
        try {
            const { installment_id, amount_paid, payment_method, next_due_date } = paymentData;

            if (amount_paid < 0) {
                return { success: false, message: 'Payment amount cannot be negative' };
            }

            const result = await dbModule.withTransaction(async (conn) => {
                const installment = await conn.dbGet('SELECT * FROM installments WHERE installment_id = ?', [installment_id]);
                if (!installment) {
                    throw new Error('Installment not found');
                }

                if (amount_paid > installment.remaining_balance) {
                    throw new Error('Payment amount exceeds remaining balance');
                }

                const new_balance = installment.remaining_balance - amount_paid;
                const new_status = new_balance <= 0 ? 'Completed' : 'Active';

                if (!next_due_date && new_status === 'Active') {
                    throw new Error('Next due date is required');
                }

                await conn.dbRun(
                    'INSERT INTO installment_payments (installment_id, amount_paid, payment_method, remaining_balance_after) VALUES (?, ?, ?, ?)',
                    [installment_id, amount_paid, payment_method || 'Cash', new_balance]
                );

                await conn.dbRun(
                    'UPDATE installments SET remaining_balance = ?, status = ?, next_due_date = ? WHERE installment_id = ?',
                    [new_balance, new_status, next_due_date || installment.next_due_date, installment_id]
                );

                return { new_balance };
            });

            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Record Payment',
                `Recorded payment of Rs. ${amount_paid} (${payment_method || 'Cash'}) for Installment ID: ${installment_id}. New Balance: Rs. ${result.new_balance.toFixed(2)}`
            );

            return { success: true, message: 'Payment recorded successfully', new_balance: result.new_balance };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('update-installment', async (event, installmentData) => {
        try {
            const { installment_id, total_amount, remaining_balance, monthly_amount, next_due_date, status, installment_duration } = installmentData;

            if (total_amount < 0 || remaining_balance < 0 || monthly_amount < 0) {
                return { success: false, message: 'Installment values cannot be negative' };
            }
            if (remaining_balance > total_amount) {
                return { success: false, message: 'Remaining balance cannot be greater than total amount' };
            }

            await dbModule.dbRun(
                'UPDATE installments SET total_amount = ?, remaining_balance = ?, monthly_amount = ?, next_due_date = ?, status = ? WHERE installment_id = ?',
                [total_amount, remaining_balance, monthly_amount, next_due_date, status, installment_id]
            );

            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Update Installment',
                `Updated installment plan: ${installment_duration} months, Rs. ${monthly_amount}/mo for ID: ${installment_id}`
            );

            return { success: true, message: 'Installment plan updated successfully' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('delete-installment', async (event, installment_id) => {
        try {
            await dbModule.withTransaction(async (conn) => {
                const row = await conn.dbGet('SELECT sale_id, status FROM installments WHERE installment_id = ?', [installment_id]);
                if (!row) {
                    throw new Error('Installment not found');
                }

                const { sale_id, status } = row;

                if (status === 'Completed') {
                    await conn.dbRun('UPDATE installments SET is_deleted = 1 WHERE installment_id = ?', [installment_id]);
                } else {
                    await conn.dbRun('UPDATE installments SET status = "Completed", remaining_balance = 0, is_deleted = 1 WHERE installment_id = ?', [installment_id]);
                    await conn.dbRun('UPDATE sales SET status = "Returned" WHERE sale_id = ?', [sale_id]);
                }
            });

            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Delete Installment',
                `Deleted/Returned installment plan for ID: ${installment_id}`
            );

            return { success: true, message: 'Installment deleted successfully.' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-payment-history', async (event, installment_id) => {
        try {
            const rows = await dbModule.dbAll(
                'SELECT * FROM installment_payments WHERE installment_id = ? ORDER BY payment_date DESC',
                [installment_id]
            );
            return { success: true, payments: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-all-payments', async (event, filters = {}) => {
        try {
            const page = parseInt(filters.page, 10) || 1;
            const pageSize = parseInt(filters.pageSize, 10) || 10;
            const offset = (page - 1) * pageSize;
            const { search, startDate, endDate } = filters;

            let baseQuery = `
                FROM installment_payments ip
                JOIN installments i ON ip.installment_id = i.installment_id
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.is_deleted = 0
            `;

            const params = [];
            const conditions = [];

            if (search) {
                conditions.push('(c.full_name LIKE ? OR s.sale_id LIKE ? OR c.id_number LIKE ?)');
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (startDate) {
                conditions.push('DATE(ip.payment_date) >= DATE(?)');
                params.push(startDate);
            }

            if (endDate) {
                conditions.push('DATE(ip.payment_date) <= DATE(?)');
                params.push(endDate);
            }

            if (conditions.length > 0) {
                baseQuery += ' AND ' + conditions.join(' AND ');
            }

            const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
            const countRow = await dbModule.dbGet(countQuery, params);
            const totalCount = countRow ? countRow.total : 0;

            const dataQuery = `
                SELECT ip.*, i.total_amount, i.monthly_amount, i.installment_id,
                       c.full_name as customer_name, s.sale_id
                ${baseQuery}
                ORDER BY ip.payment_date DESC
                LIMIT ? OFFSET ?
            `;

            const dataParams = [...params, pageSize, offset];
            const rows = await dbModule.dbAll(dataQuery, dataParams);

            return {
                success: true,
                payments: rows,
                totalCount,
                page,
                pageSize
            };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerInstallmentHandlers;
