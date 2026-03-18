const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // Authentication
    login: (credentials) => ipcRenderer.invoke('login', credentials),
    changePassword: (data) => ipcRenderer.invoke('change-password', data),
    updateProfile: (data) => ipcRenderer.invoke('update-profile', data),
    recoverPassword: (data) => ipcRenderer.invoke('recover-password', data),
    updateRecoveryCode: (data) => ipcRenderer.invoke('update-recovery-code', data),

    // Products
    getAllProducts: (filters) => ipcRenderer.invoke('get-all-products', filters),
    addProduct: (product) => ipcRenderer.invoke('add-product', product),
    updateProduct: (product) => ipcRenderer.invoke('update-product', product),
    deleteProduct: (productId) => ipcRenderer.invoke('delete-product', productId),
    searchProducts: (searchTerm) => ipcRenderer.invoke('search-products', searchTerm),
    getLowStockProducts: () => ipcRenderer.invoke('get-low-stock-products'),

    // Customers
    getAllCustomers: () => ipcRenderer.invoke('get-all-customers'),
    addCustomer: (customer) => ipcRenderer.invoke('add-customer', customer),
    updateCustomer: (customer) => ipcRenderer.invoke('update-customer', customer),
    deleteCustomer: (customerId) => ipcRenderer.invoke('delete-customer', customerId),
    searchCustomers: (searchTerm) => ipcRenderer.invoke('search-customers', searchTerm),
    getCustomerHistory: (customerId) => ipcRenderer.invoke('get-customer-history', customerId),

    // Sales
    createSale: (saleData) => ipcRenderer.invoke('create-sale', saleData),
    getAllSales: (filters) => ipcRenderer.invoke('get-all-sales', filters),
    getSaleDetails: (saleId) => ipcRenderer.invoke('get-sale-details', saleId),
    getDailySales: (date) => ipcRenderer.invoke('get-daily-sales', date),
    getMonthlySales: (year, month) => ipcRenderer.invoke('get-monthly-sales', year, month),
    deleteAllSales: () => ipcRenderer.invoke('delete-all-sales'),
    processSaleReturn: (data) => ipcRenderer.invoke('process-sale-return', data),
    downloadInvoice: (saleId) => ipcRenderer.invoke('download-invoice', saleId),

    // Installments
    getAllInstallments: (filters) => ipcRenderer.invoke('get-all-installments', filters),
    updateInstallment: (installmentData) => ipcRenderer.invoke('update-installment', installmentData),
    deleteInstallment: (installmentId) => ipcRenderer.invoke('delete-installment', installmentId),
    getDueInstallments: () => ipcRenderer.invoke('get-due-installments'),
    getOverdueInstallments: () => ipcRenderer.invoke('get-overdue-installments'),
    recordInstallmentPayment: (paymentData) => ipcRenderer.invoke('record-installment-payment', paymentData),
    getPaymentHistory: (installmentId) => ipcRenderer.invoke('get-payment-history', installmentId),
    getAllPayments: (filters) => ipcRenderer.invoke('get-all-payments', filters),

    // Dashboard & Alerts
    getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),
    getDashboardAlerts: () => ipcRenderer.invoke('get-dashboard-alerts'),

    // Reports
    getDailySalesReport: (date) => ipcRenderer.invoke('get-daily-sales-report', date),
    getMonthlySalesReport: (month) => ipcRenderer.invoke('get-monthly-sales-report', month),
    getInstallmentReport: () => ipcRenderer.invoke('get-installment-report'),
    getOverdueReport: () => ipcRenderer.invoke('get-overdue-report'),
    getInventoryReport: () => ipcRenderer.invoke('get-inventory-report'),
    getProfitLossReport: (period) => ipcRenderer.invoke('get-profit-loss-report', period),
    getSalesReportByDateRange: (params) => ipcRenderer.invoke('get-sales-report-by-date-range', params),

    // Utility
    getCategories: () => ipcRenderer.invoke('get-categories'),
    getBrands: () => ipcRenderer.invoke('get-brands'),
    getActivityLogs: (limit) => ipcRenderer.invoke('get-activity-logs', limit),
    clearActivityLogs: () => ipcRenderer.invoke('clear-activity-logs'),
    log: (level, message) => ipcRenderer.invoke('log', level, message),

    // Database Management
    exportDatabase: () => ipcRenderer.invoke('export-database'),
    importDatabase: () => ipcRenderer.invoke('import-database')
});

console.log('Preload script loaded - API exposed to renderer');
