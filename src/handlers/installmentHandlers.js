function registerInstallmentHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser } = context;

    ipcMain.handle('get-all-installments', async (event, filters = {}) => {
        try {
            // First, update status based on next_due_date for all relevant installments
            await new Promise((resolve, reject) => {
                dbModule.db.serialize(() => {
                    // Active becomes Overdue
                    dbModule.db.run(`
                        UPDATE installments 
                        SET status = 'Overdue' 
                        WHERE status = 'Active' AND DATE(next_due_date) < DATE('now', 'localtime')
                    `, (err) => { if (err) reject(err); });

                    // Overdue becomes Active (if date was extended)
                    dbModule.db.run(`
                        UPDATE installments 
                        SET status = 'Active' 
                        WHERE status = 'Overdue' AND DATE(next_due_date) >= DATE('now', 'localtime')
                    `, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            // Now fetch filtered results
            return new Promise((resolve, reject) => {
                let query = `
                    SELECT i.*, c.full_name as customer_name, c.id_number, s.sale_date,
                    (SELECT GROUP_CONCAT(product_name, ', ') FROM sale_items WHERE sale_id = s.sale_id) as product_names,
                    (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                    FROM installments i
                    JOIN sales s ON i.sale_id = s.sale_id
                    LEFT JOIN customers c ON s.customer_id = c.customer_id
                    WHERE s.is_deleted = 0
                `;
                const params = [];

                if (filters.status === 'Overdue') {
                    query += " AND (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now', 'localtime')))";
                } else if (filters.status === 'Active') {
                    query += " AND i.status = 'Active' AND DATE(i.next_due_date) >= DATE('now', 'localtime')";
                } else if (filters.status) {
                    query += ' AND i.status = ?';
                    params.push(filters.status);
                }

                query += ' ORDER BY i.installment_id DESC';

                dbModule.db.all(query, params, (err, rows) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else {
                        resolve({ success: true, installments: rows });
                    }
                });
            });
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-due-installments', async () => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT i.*, c.full_name as customer_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE i.status IN ('Active', 'Overdue') AND DATE(i.next_due_date) <= DATE('now', 'localtime') AND s.is_deleted = 0
                ORDER BY i.next_due_date ASC
            `;

            dbModule.db.all(query, (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, installments: rows });
                }
            });
        });
    });

    ipcMain.handle('get-overdue-installments', async () => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT i.*, c.full_name as customer_name
                FROM installments i
                JOIN sales s ON i.sale_id = s.sale_id
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE (i.status = 'Overdue' OR (i.status = 'Active' AND DATE(i.next_due_date) < DATE('now', 'localtime')))
                ORDER BY i.next_due_date ASC
            `;

            dbModule.db.all(query, (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, installments: rows });
                }
            });
        });
    });

    ipcMain.handle('record-installment-payment', async (event, paymentData) => {
        return new Promise((resolve, reject) => {
            const { installment_id, amount_paid, payment_method, next_due_date } = paymentData;

            if (amount_paid < 0) {
                return reject({ success: false, message: 'Payment amount cannot be negative' });
            }

            dbModule.db.serialize(() => {
                dbModule.db.run('BEGIN TRANSACTION');

                dbModule.db.get('SELECT * FROM installments WHERE installment_id = ?', [installment_id], (err, installment) => {
                    if (err) {
                        dbModule.db.run('ROLLBACK');
                        return reject({ success: false, message: err.message });
                    }

                    if (installment && amount_paid > installment.remaining_balance) {
                        dbModule.db.run('ROLLBACK');
                        return reject({ success: false, message: 'Payment amount exceeds remaining balance' });
                    }

                    const new_balance = installment.remaining_balance - amount_paid;
                    const new_status = new_balance <= 0 ? 'Completed' : 'Active';

                    if (!next_due_date && new_status === 'Active') {
                        dbModule.db.run('ROLLBACK');
                        return reject({ success: false, message: 'Next due date is required' });
                    }

                    dbModule.db.run(
                        'INSERT INTO installment_payments (installment_id, amount_paid, payment_method, remaining_balance_after) VALUES (?, ?, ?, ?)',
                        [installment_id, amount_paid, payment_method || 'Cash', new_balance],
                        (err) => {
                            if (err) {
                                dbModule.db.run('ROLLBACK');
                                return reject({ success: false, message: err.message });
                            }

                            dbModule.db.run(
                                'UPDATE installments SET remaining_balance = ?, status = ?, next_due_date = ? WHERE installment_id = ?',
                                [new_balance, new_status, next_due_date, installment_id],
                                (err) => {
                                    if (err) {
                                        dbModule.db.run('ROLLBACK');
                                        return reject({ success: false, message: err.message });
                                    }

                                    dbModule.db.run('COMMIT', (err) => {
                                        if (err) {
                                            dbModule.db.run('ROLLBACK');
                                            return resolve({ success: false, message: err.message });
                                        }
                                    dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Record Payment', `Recorded payment of Rs. ${amount_paid} (${payment_method || 'Cash'}) for Installment ID: ${installment_id}. New Balance: Rs. ${new_balance.toFixed(2)}`);
                                    resolve({ success: true, message: 'Payment recorded successfully', new_balance });
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    });

    ipcMain.handle('update-installment', async (event, installmentData) => {
        return new Promise((resolve, reject) => {
            const { installment_id, total_amount, remaining_balance, monthly_amount, next_due_date, status, installment_duration } = installmentData;

            if (total_amount < 0 || remaining_balance < 0 || monthly_amount < 0) {
                return reject({ success: false, message: 'Installment values cannot be negative' });
            }
            if (remaining_balance > total_amount) {
                return reject({ success: false, message: 'Remaining balance cannot be greater than total amount' });
            }

            dbModule.db.run(
                'UPDATE installments SET total_amount = ?, remaining_balance = ?, monthly_amount = ?, next_due_date = ?, status = ? WHERE installment_id = ?',
                [total_amount, remaining_balance, monthly_amount, next_due_date, status, installment_id],
                (err) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else {
                        dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Update Installment', `Updated installment plan: ${installment_duration} months, Rs. ${monthly_amount}/mo for ID: ${installment_id}`);
                        resolve({ success: true, message: 'Installment plan updated successfully' });
                    }
                }
            );
        });
    });

    ipcMain.handle('delete-installment', async (event, installment_id) => {
        return new Promise((resolve, reject) => {
            dbModule.db.serialize(() => {
                dbModule.db.run('BEGIN TRANSACTION');

                dbModule.db.get('SELECT sale_id FROM installments WHERE installment_id = ?', [installment_id], (err, row) => {
                    if (err || !row) {
                        dbModule.db.run('ROLLBACK');
                        return reject({ success: false, message: err ? err.message : 'Installment not found' });
                    }
                    const sale_id = row.sale_id;

                    dbModule.db.run('UPDATE installments SET status = "Completed", remaining_balance = 0 WHERE installment_id = ?', [installment_id], (err) => {
                        if (err) {
                            dbModule.db.run('ROLLBACK');
                            return reject({ success: false, message: err.message });
                        }

                        dbModule.db.run('UPDATE sales SET status = "Returned" WHERE sale_id = ?', [sale_id], (err) => {
                            if (err) {
                                dbModule.db.run('ROLLBACK');
                                return reject({ success: false, message: err.message });
                            }

                            dbModule.db.run('COMMIT', (err) => {
                                if (err) {
                                    dbModule.db.run('ROLLBACK');
                                    return reject({ success: false, message: err.message });
                                }
                                dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Delete Installment', `Returned/Completed installment for Sale ID: ${sale_id}`);
                                resolve({ success: true, message: 'Installment returned successfully, history preserved.' });
                            });
                        });
                    });
                });
            });
        });
    });

    ipcMain.handle('get-payment-history', async (event, installment_id) => {
        return new Promise((resolve, reject) => {
            dbModule.db.all(
                'SELECT * FROM installment_payments WHERE installment_id = ? ORDER BY payment_date DESC',
                [installment_id],
                (err, rows) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else {
                        resolve({ success: true, payments: rows });
                    }
                }
            );
        });
    });

    ipcMain.handle('get-all-payments', async (event, filters = {}) => {
        return new Promise((resolve, reject) => {
            const { page = 1, pageSize = 10, search, startDate, endDate } = filters;
            const offset = (page - 1) * pageSize;

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
                conditions.push('DATE(ip.payment_date, "localtime") >= DATE(?, "localtime")');
                params.push(startDate);
            }

            if (endDate) {
                conditions.push('DATE(ip.payment_date, "localtime") <= DATE(?, "localtime")');
                params.push(endDate);
            }

            if (conditions.length > 0) {
                baseQuery += ' AND ' + conditions.join(' AND ');
            }

            const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
            const dataQuery = `
                SELECT ip.*, i.total_amount, i.monthly_amount, i.installment_id,
                       c.full_name as customer_name, s.sale_id
                ${baseQuery}
                ORDER BY ip.payment_date DESC
                LIMIT ? OFFSET ?
            `;

            dbModule.db.get(countQuery, params, (err, countRow) => {
                if (err) return reject({ success: false, message: err.message });

                const totalCount = countRow ? countRow.total : 0;
                const dataParams = [...params, pageSize, offset];

                dbModule.db.all(dataQuery, dataParams, (err, rows) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else {
                        resolve({
                            success: true,
                            payments: rows,
                            totalCount,
                            page,
                            pageSize
                        });
                    }
                });
            });
        });
    });
}

module.exports = registerInstallmentHandlers;
