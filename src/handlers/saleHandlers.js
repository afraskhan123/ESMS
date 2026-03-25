const fs = require('fs');

function registerSaleHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser, dialog, BrowserWindow } = context;

    ipcMain.handle('create-sale', async (event, saleData) => {
        return new Promise((resolve, reject) => {
            try {
                const { customer_id, walkin_name, items, payment_type, total_amount, installment_data } = saleData;
                
                if (!items || !Array.isArray(items)) {
                    return resolve({ success: false, message: 'Invalid items provided' });
                }

                if (total_amount < 0) {
                    return resolve({ success: false, message: 'Total amount cannot be negative' });
                }

            const getWalkinId = () => {
                return new Promise((res) => {
                    if (!customer_id || customer_id === '0') {
                        dbModule.getDatabase().get('SELECT MAX(walkin_id) as maxId FROM sales', (err, row) => {
                            res(row && row.maxId ? row.maxId + 1 : 1);
                        });
                    } else {
                        res(null);
                    }
                });
            };

            const proceedWithSale = (walkin_id = null) => {
                dbModule.db.serialize(() => {
                    dbModule.db.run('BEGIN TRANSACTION');

                    // Insert sale
                    dbModule.db.run(
                        'INSERT INTO sales (customer_id, walkin_name, walkin_id, total_amount, payment_type) VALUES (?, ?, ?, ?, ?)',
                        [customer_id, walkin_name, walkin_id, total_amount, payment_type],
                    function (err) {
                        if (err) {
                            dbModule.db.run('ROLLBACK');
                            return resolve({ success: false, message: err.message });
                        }

                        const sale_id = this.lastID;

                        // Insert sale items and update stock
                        let itemsProcessed = 0;
                        let errorOccurred = false;

                        // We need to process items sequentially to handle errors/rollbacks correctly
                        const processNextItem = (index) => {
                            if (index >= items.length) {
                                if (!errorOccurred) {
                                    finalizeSale();
                                }
                                return;
                            }

                            const item = items[index];
                            dbModule.db.run(
                                'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                [sale_id, item.product_id, item.product_name, item.quantity, item.unit_price, item.subtotal, item.purchase_price || 0],
                                (err) => {
                                    if (err) {
                                        if (!errorOccurred) {
                                            errorOccurred = true;
                                            dbModule.db.run('ROLLBACK');
                                            resolve({ success: false, message: err.message });
                                        }
                                        return;
                                    }

                                    // Update product stock with VALIDATION
                                    if (item.product_id) {
                                        dbModule.db.run(
                                            'UPDATE products SET stock_qty = stock_qty - ? WHERE product_id = ? AND stock_qty >= ?',
                                            [item.quantity, item.product_id, item.quantity],
                                            function (err) {
                                                if (err) {
                                                    if (!errorOccurred) {
                                                        errorOccurred = true;
                                                        dbModule.db.run('ROLLBACK');
                                                        resolve({ success: false, message: err.message });
                                                    }
                                                    return;
                                                }

                                                if (this.changes === 0) {
                                                    if (!errorOccurred) {
                                                        errorOccurred = true;
                                                        dbModule.db.run('ROLLBACK');
                                                        resolve({ success: false, message: `Insufficient stock for product: ${item.product_name}` });
                                                    }
                                                    return;
                                                }

                                                processNextItem(index + 1);
                                            }
                                        );
                                    } else {
                                        processNextItem(index + 1);
                                    }
                                }
                            );
                        };

                        const finalizeSale = () => {
                            if (payment_type === 'Installment' && installment_data) {
                                const { down_payment, installment_duration, monthly_amount, next_due_date,
                                    guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address } = installment_data;
                                const remaining_balance = total_amount - down_payment;

                                dbModule.db.run(
                                    `INSERT INTO installments (sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date, guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date,
                                        guarantor_name || null, guarantor_cnic || null, guarantor_mobile || null, guarantor_address || null],
                                    (err) => {
                                        if (err) {
                                            dbModule.db.run('ROLLBACK');
                                            return resolve({ success: false, message: err.message });
                                        }

                                        dbModule.db.run('COMMIT', (err) => {
                                            if (err) {
                                                dbModule.db.run('ROLLBACK');
                                                return resolve({ success: false, message: err.message });
                                            }
                                            const productNames = items.map(i => i.product_name).join(', ');
                                            dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Create Sale', `New installment sale (ID: ${sale_id}). Customer ID: ${customer_id}, Products: ${productNames}, Total: Rs. ${total_amount}, Duration: ${installment_duration} Mo.`);
                                            resolve({ success: true, message: 'Sale created successfully', sale_id });
                                        });
                                    }
                                );
                            } else {
                                dbModule.db.run('COMMIT', (err) => {
                                    if (err) {
                                        dbModule.db.run('ROLLBACK');
                                        return resolve({ success: false, message: err.message });
                                    }
                                    const productNames = items.map(i => i.product_name).join(', ');
                                    dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Create Sale', `New cash sale (ID: ${sale_id}). Customer: ${customer_id ? 'ID ' + customer_id : (walkin_name || 'Walk-in')}, Products: ${productNames}, Total: Rs. ${total_amount}`);
                                    resolve({ success: true, message: 'Sale created successfully', sale_id });
                                });
                            }
                        };

                        processNextItem(0);
                    }
                );
            });
            };

            getWalkinId().then(wId => {
                proceedWithSale(wId);
            });
            } catch (error) {
                return resolve({ success: false, message: error.message || 'An unknown error occurred during sale creation' });
            }
        });
    });

    ipcMain.handle('get-all-sales', async (event, filters = {}) => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.is_hidden = 0 AND s.is_deleted = 0
                ORDER BY s.sale_date DESC
            `;

            dbModule.db.all(query, (err, rows) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, sales: rows });
                }
            });
        });
    });

    ipcMain.handle('delete-all-sales', async () => {
        return new Promise((resolve, reject) => {
            dbModule.db.run('UPDATE sales SET is_hidden = 1', (err) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, message: 'Recent sales history cleared from view' });
                }
            });
        });
    });

    ipcMain.handle('get-sale-details', async (event, sale_id) => {
        return new Promise((resolve, reject) => {
            const saleQuery = `
                    SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id, c.phone, c.address,
                           i.installment_id, i.down_payment, i.installment_duration, i.monthly_amount, i.next_due_date, i.remaining_balance,
                           i.guarantor_name, i.guarantor_cnic, i.guarantor_mobile, i.guarantor_address
                    FROM sales s
                    LEFT JOIN customers c ON s.customer_id = c.customer_id
                    LEFT JOIN installments i ON s.sale_id = i.sale_id
                    WHERE s.sale_id = ? AND s.is_deleted = 0
                `;

            dbModule.db.get(saleQuery, [sale_id], (err, sale) => {
                if (err) {
                    return reject({ success: false, message: err.message });
                }

                if (!sale) {
                    return reject({ success: false, message: 'Sale not found' });
                }

                dbModule.db.all('SELECT * FROM sale_items WHERE sale_id = ?', [sale_id], (err, items) => {
                    if (err) {
                        return reject({ success: false, message: err.message });
                    }

                    sale.items = items;

                    if (sale.payment_type === 'Installment' && sale.installment_id) {
                        dbModule.db.all('SELECT *, COALESCE(payment_method, \'Cash\') as payment_method FROM installment_payments WHERE installment_id = ? ORDER BY payment_date ASC',
                            [sale.installment_id],
                            (err, payments) => {
                                if (err) {
                                    return reject({ success: false, message: err.message });
                                }
                                sale.payments = payments;
                                resolve({ success: true, sale });
                            });
                    } else {
                        resolve({ success: true, sale });
                    }
                });
            });
        });
    });

    ipcMain.handle('process-sale-return', async (event, { saleId, items }) => {
        return new Promise((resolve, reject) => {
            dbModule.db.serialize(() => {
                dbModule.db.run('BEGIN TRANSACTION');

                const processReturns = async () => {
                    try {
                        let totalRefund = 0;
                        let returnedProductNames = [];

                        for (const itemReturn of items) {
                            const { saleItemId, returnQty } = itemReturn;

                            const item = await new Promise((res, rej) => {
                                dbModule.db.get('SELECT * FROM sale_items WHERE sale_item_id = ?', [saleItemId], (err, row) => {
                                    if (err) rej(err); else res(row);
                                });
                            });

                            if (!item) throw new Error('Sale item not found');
                            if (returnQty > (item.quantity - (item.returned_qty || 0))) {
                                throw new Error(`Return quantity for ${item.product_name} exceeds available quantity`);
                            }

                            const effectiveUnitPrice = item.subtotal / item.quantity;
                            const itemRefund = returnQty * effectiveUnitPrice;
                            totalRefund += itemRefund;

                            await new Promise((res, rej) => {
                                dbModule.db.run('UPDATE sale_items SET returned_qty = COALESCE(returned_qty, 0) + ? WHERE sale_item_id = ?',
                                    [returnQty, saleItemId], (err) => err ? rej(err) : res());
                            });

                            await new Promise((res, rej) => {
                                dbModule.db.run('UPDATE products SET stock_qty = stock_qty + ? WHERE product_id = ?',
                                    [returnQty, item.product_id], (err) => err ? rej(err) : res());
                            });
                            
                            returnedProductNames.push(`${item.product_name} (x${returnQty})`);
                        }

                        await new Promise((res, rej) => {
                            dbModule.db.run('UPDATE sales SET total_amount = total_amount - ? WHERE sale_id = ?',
                                [totalRefund, saleId], (err) => err ? rej(err) : res());
                        });

                        const installment = await new Promise((res, rej) => {
                            dbModule.db.get('SELECT * FROM installments WHERE sale_id = ?', [saleId], (err, row) => {
                                if (err) rej(err); else res(row);
                            });
                        });

                        let responseMessage = 'Return processed successfully.';
                        let cashRefundAmount = totalRefund;
                        let deductedFromBalance = 0;

                        if (installment) {
                            const newTotal = installment.total_amount - totalRefund;
                            const newRemaining = Math.max(0, installment.remaining_balance - totalRefund);

                            deductedFromBalance = installment.remaining_balance - newRemaining;
                            cashRefundAmount = Math.max(0, totalRefund - deductedFromBalance);

                            const newStatus = newRemaining <= 0 ? 'Completed' : installment.status;

                            await new Promise((res, rej) => {
                                dbModule.db.run('UPDATE installments SET total_amount = ?, remaining_balance = ?, status = ? WHERE installment_id = ?',
                                    [newTotal, newRemaining, newStatus, installment.installment_id], (err) => err ? rej(err) : res());
                            });

                            if (cashRefundAmount > 0) {
                                await new Promise((res, rej) => {
                                    dbModule.db.run(
                                        'INSERT INTO installment_payments (installment_id, amount_paid, remaining_balance_after) VALUES (?, ?, ?)',
                                        [installment.installment_id, -cashRefundAmount, newRemaining],
                                        (err) => err ? rej(err) : res()
                                    );
                                });
                            }

                            responseMessage = `Return processed. Rs. ${deductedFromBalance.toFixed(2)} deducted from balance. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                        } else {
                            responseMessage = `Return processed. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                        }

                        dbModule.db.run('COMMIT', (err) => {
                            if (err) throw err;
                            dbModule.logActivity(getCurrentUser()?.username || 'admin', 'Sale Return', `Processed return for Sale ID: ${saleId}. Products: ${returnedProductNames.join(', ')}. Refund: Rs. ${totalRefund.toFixed(2)}`);
                            resolve({
                                success: true,
                                message: responseMessage,
                                totalRefund: totalRefund,
                                cashRefundAmount: cashRefundAmount,
                                deductedFromBalance: deductedFromBalance
                            });
                        });

                    } catch (error) {
                        dbModule.db.run('ROLLBACK');
                        resolve({ success: false, message: error.message });
                    }
                };

                processReturns();
            });
        });
    });

    ipcMain.handle('download-invoice', async (event, saleId) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);

            const { filePath } = await dialog.showSaveDialog(win, {
                title: 'Save Invoice PDF',
                defaultPath: `Invoice_${saleId}.pdf`,
                filters: [
                    { name: 'PDF Document', extensions: ['pdf'] }
                ]
            });

            if (!filePath) {
                return { success: false, message: 'Download cancelled' };
            }

            const pdfData = await event.sender.printToPDF({
                pageSize: 'A4',
                printBackground: true,
                marginType: 'custom',
                margins: {
                    top: 0.3,
                    bottom: 0.3,
                    left: 0.3,
                    right: 0.3
                }
            });

            fs.writeFileSync(filePath, pdfData);
            return { success: true, message: 'Invoice saved successfully', filePath };
        } catch (error) {
            console.error('Error generating PDF:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-daily-sales', async () => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT
                    COALESCE(SUM(
                        CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                             WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                             ELSE 0 END
                    ), 0)
                    + COALESCE((
                        SELECT SUM(ip.amount_paid)
                        FROM installment_payments ip
                        WHERE DATE(ip.payment_date) = DATE('now')
                    ), 0) as total
                FROM sales s
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE DATE(s.sale_date) = DATE('now') AND s.is_deleted = 0
            `;

            dbModule.db.get(query, (err, row) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, total: row.total });
                }
            });
        });
    });

    ipcMain.handle('get-monthly-sales', async () => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT
                    COALESCE(SUM(
                        CASE WHEN s.payment_type = 'Cash' THEN s.total_amount
                             WHEN s.payment_type = 'Installment' THEN COALESCE(i.down_payment, 0)
                             ELSE 0 END
                    ), 0)
                    + COALESCE((
                        SELECT SUM(ip.amount_paid)
                        FROM installment_payments ip
                        WHERE strftime('%Y-%m', ip.payment_date) = strftime('%Y-%m', 'now')
                    ), 0) as total
                FROM sales s
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE strftime('%Y-%m', s.sale_date) = strftime('%Y-%m', 'now') AND s.is_deleted = 0
            `;

            dbModule.db.get(query, (err, row) => {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    resolve({ success: true, total: row.total });
                }
            });
        });
    });
}

module.exports = registerSaleHandlers;
