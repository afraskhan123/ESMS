const fs = require('fs');

function registerSaleHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser, dialog, BrowserWindow } = context;

    ipcMain.handle('create-sale', async (event, saleData) => {
        try {
            const { customer_id, walkin_name, items, payment_type, total_amount, installment_data } = saleData;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return { success: false, message: 'Invalid items provided' };
            }

            if (total_amount < 0) {
                return { success: false, message: 'Total amount cannot be negative' };
            }

            const result = await dbModule.withTransaction(async (conn) => {
                // 1. Calculate walkin ID if customer not registered
                let walkin_id = null;
                if (!customer_id || customer_id === '0') {
                    const row = await conn.dbGet('SELECT MAX(walkin_id) as maxId FROM sales');
                    walkin_id = row && row.maxId ? row.maxId + 1 : 1;
                }

                // 2. Insert Sale
                const saleResult = await conn.dbRun(
                    'INSERT INTO sales (customer_id, walkin_name, walkin_id, total_amount, payment_type) VALUES (?, ?, ?, ?, ?)',
                    [customer_id || null, walkin_name || null, walkin_id, total_amount, payment_type]
                );
                const sale_id = saleResult.insertId;

                // 3. Insert Sale Items and Atomically Deduct Stock
                for (const item of items) {
                    await conn.dbRun(
                        'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [sale_id, item.product_id || null, item.product_name, item.quantity, item.unit_price, item.subtotal, item.purchase_price || 0]
                    );

                    if (item.product_id) {
                        const stockResult = await conn.dbRun(
                            'UPDATE products SET stock_qty = stock_qty - ? WHERE product_id = ? AND stock_qty >= ?',
                            [item.quantity, item.product_id, item.quantity]
                        );

                        if (stockResult.affectedRows === 0) {
                            throw new Error(`Insufficient stock for product: ${item.product_name}`);
                        }
                    }
                }

                // 4. Handle Installment plan creation if applicable
                if (payment_type === 'Installment' && installment_data) {
                    const {
                        down_payment = 0,
                        installment_duration,
                        monthly_amount,
                        next_due_date,
                        guarantor_name,
                        guarantor_cnic,
                        guarantor_mobile,
                        guarantor_address
                    } = installment_data;
                    const remaining_balance = total_amount - down_payment;

                    await conn.dbRun(
                        `INSERT INTO installments (sale_id, down_payment, total_amount, remaining_balance, monthly_amount, installment_duration, next_due_date, guarantor_name, guarantor_cnic, guarantor_mobile, guarantor_address)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            sale_id,
                            down_payment,
                            total_amount,
                            remaining_balance,
                            monthly_amount,
                            installment_duration,
                            next_due_date,
                            guarantor_name || null,
                            guarantor_cnic || null,
                            guarantor_mobile || null,
                            guarantor_address || null
                        ]
                    );
                }

                return { sale_id };
            });

            const productNames = items.map(i => i.product_name).join(', ');
            if (payment_type === 'Installment') {
                await dbModule.logActivity(
                    getCurrentUser()?.username || 'admin',
                    'Create Sale',
                    `New installment sale (ID: ${result.sale_id}). Customer: ${customer_id ? 'ID ' + customer_id : (walkin_name || 'Walk-in')}, Products: ${productNames}, Total: Rs. ${total_amount}`
                );
            } else {
                await dbModule.logActivity(
                    getCurrentUser()?.username || 'admin',
                    'Create Sale',
                    `New cash sale (ID: ${result.sale_id}). Customer: ${customer_id ? 'ID ' + customer_id : (walkin_name || 'Walk-in')}, Products: ${productNames}, Total: Rs. ${total_amount}`
                );
            }

            return { success: true, message: 'Sale created successfully', sale_id: result.sale_id };
        } catch (error) {
            return { success: false, message: error.message || 'An unknown error occurred during sale creation' };
        }
    });

    ipcMain.handle('get-all-sales', async () => {
        try {
            const query = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id AND si.returned_qty > 0) as return_count
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.is_hidden = 0 AND s.is_deleted = 0
                ORDER BY s.sale_date DESC
            `;
            const rows = await dbModule.dbAll(query);
            return { success: true, sales: rows };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('delete-all-sales', async () => {
        try {
            await dbModule.dbRun('UPDATE sales SET is_hidden = 1');
            return { success: true, message: 'Recent sales history cleared from view' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-sale-details', async (event, sale_id) => {
        try {
            const saleQuery = `
                SELECT s.*, COALESCE(c.full_name, s.walkin_name) as customer_name, s.walkin_id, c.phone, c.address,
                       i.installment_id, i.down_payment, i.installment_duration, i.monthly_amount, i.next_due_date, i.remaining_balance,
                       i.guarantor_name, i.guarantor_cnic, i.guarantor_mobile, i.guarantor_address
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN installments i ON s.sale_id = i.sale_id
                WHERE s.sale_id = ? AND s.is_deleted = 0
            `;

            const sale = await dbModule.dbGet(saleQuery, [sale_id]);
            if (!sale) {
                return { success: false, message: 'Sale not found' };
            }

            const items = await dbModule.dbAll('SELECT * FROM sale_items WHERE sale_id = ?', [sale_id]);
            sale.items = items;

            if (sale.payment_type === 'Installment' && sale.installment_id) {
                const payments = await dbModule.dbAll(
                    'SELECT *, COALESCE(payment_method, \'Cash\') as payment_method FROM installment_payments WHERE installment_id = ? ORDER BY payment_date ASC',
                    [sale.installment_id]
                );
                sale.payments = payments;
            }

            return { success: true, sale };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('process-sale-return', async (event, { saleId, items }) => {
        try {
            let totalRefund = 0;
            let cashRefundAmount = 0;
            let deductedFromBalance = 0;
            let returnedProductNames = [];
            let responseMessage = 'Return processed successfully.';

            await dbModule.withTransaction(async (conn) => {
                for (const itemReturn of items) {
                    const { saleItemId, returnQty } = itemReturn;

                    const item = await conn.dbGet('SELECT * FROM sale_items WHERE sale_item_id = ?', [saleItemId]);
                    if (!item) throw new Error('Sale item not found');

                    const availableReturn = item.quantity - (item.returned_qty || 0);
                    if (returnQty > availableReturn) {
                        throw new Error(`Return quantity for ${item.product_name} exceeds available quantity`);
                    }

                    const effectiveUnitPrice = item.subtotal / item.quantity;
                    const itemRefund = returnQty * effectiveUnitPrice;
                    totalRefund += itemRefund;

                    await conn.dbRun(
                        'UPDATE sale_items SET returned_qty = COALESCE(returned_qty, 0) + ? WHERE sale_item_id = ?',
                        [returnQty, saleItemId]
                    );

                    if (item.product_id) {
                        await conn.dbRun(
                            'UPDATE products SET stock_qty = stock_qty + ? WHERE product_id = ?',
                            [returnQty, item.product_id]
                        );
                    }

                    returnedProductNames.push(`${item.product_name} (x${returnQty})`);
                }

                await conn.dbRun(
                    'UPDATE sales SET total_amount = total_amount - ? WHERE sale_id = ?',
                    [totalRefund, saleId]
                );

                const installment = await conn.dbGet('SELECT * FROM installments WHERE sale_id = ?', [saleId]);
                cashRefundAmount = totalRefund;

                if (installment) {
                    const newTotal = installment.total_amount - totalRefund;
                    const newRemaining = Math.max(0, installment.remaining_balance - totalRefund);

                    deductedFromBalance = installment.remaining_balance - newRemaining;
                    cashRefundAmount = Math.max(0, totalRefund - deductedFromBalance);

                    const newStatus = newRemaining <= 0 ? 'Completed' : installment.status;

                    await conn.dbRun(
                        'UPDATE installments SET total_amount = ?, remaining_balance = ?, status = ? WHERE installment_id = ?',
                        [newTotal, newRemaining, newStatus, installment.installment_id]
                    );

                    if (cashRefundAmount > 0) {
                        await conn.dbRun(
                            'INSERT INTO installment_payments (installment_id, amount_paid, remaining_balance_after) VALUES (?, ?, ?)',
                            [installment.installment_id, -cashRefundAmount, newRemaining]
                        );
                    }

                    responseMessage = `Return processed. Rs. ${deductedFromBalance.toFixed(2)} deducted from balance. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                } else {
                    responseMessage = `Return processed. Rs. ${cashRefundAmount.toFixed(2)} to refund in cash.`;
                }
            });

            await dbModule.logActivity(
                getCurrentUser()?.username || 'admin',
                'Sale Return',
                `Processed return for Sale ID: ${saleId}. Products: ${returnedProductNames.join(', ')}. Refund: Rs. ${totalRefund.toFixed(2)}`
            );

            return {
                success: true,
                message: responseMessage,
                totalRefund,
                cashRefundAmount,
                deductedFromBalance
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('download-invoice', async (event, saleId) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            const { filePath } = await dialog.showSaveDialog(win, {
                title: 'Save Invoice PDF',
                defaultPath: `Invoice_${saleId}.pdf`,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
            });

            if (!filePath) {
                return { success: false, message: 'Download cancelled' };
            }

            const pdfData = await event.sender.printToPDF({
                pageSize: 'A4',
                printBackground: true,
                marginType: 'custom',
                margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 }
            });

            fs.writeFileSync(filePath, pdfData);
            return { success: true, message: 'Invoice saved successfully', filePath };
        } catch (error) {
            console.error('Error generating PDF:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-daily-sales', async () => {
        try {
            const query = `
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
            const row = await dbModule.dbGet(query);
            return { success: true, total: row ? row.total : 0 };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('get-monthly-sales', async () => {
        try {
            const query = `
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
            const row = await dbModule.dbGet(query);
            return { success: true, total: row ? row.total : 0 };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerSaleHandlers;
