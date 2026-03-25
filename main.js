const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const dbModule = require('./database');

// Handler Modules
const registerAuthHandlers = require('./src/handlers/authHandlers');
const registerProductHandlers = require('./src/handlers/productHandlers');
const registerCustomerHandlers = require('./src/handlers/customerHandlers');
const registerSaleHandlers = require('./src/handlers/saleHandlers');
const registerInstallmentHandlers = require('./src/handlers/installmentHandlers');
const registerDashboardHandlers = require('./src/handlers/dashboardHandlers');
const registerReportHandlers = require('./src/handlers/reportHandlers');
const registerUtilityHandlers = require('./src/handlers/utilityHandlers');

// Configure Technical Logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('Application starting...');

let mainWindow;
let currentUser = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false  // Allow file:// URIs for customer images stored in userData
        },
        icon: path.join(__dirname, 'assets', 'logo.jpg'),
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');
}

// Context for handlers
const context = {
    ipcMain,
    dbModule,
    log,
    app,
    dialog,
    BrowserWindow,
    getMainWindow: () => mainWindow,
    getCurrentUser: () => currentUser,
    setCurrentUser: (user) => { currentUser = user; }
};

// Initialize Handlers
registerAuthHandlers(context);
registerProductHandlers(context);
registerCustomerHandlers(context);
registerSaleHandlers(context);
registerInstallmentHandlers(context);
registerDashboardHandlers(context);
registerReportHandlers(context);
registerUtilityHandlers(context);

app.whenReady().then(async () => {
    try {
        // Initialize database and wait for it to be ready
        await dbModule.initializeDatabase();
        console.log('Database initialized successfully before window creation.');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        // We still create the window so the user sees something, but they might face errors
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

console.log('Main process initialized successfully');
