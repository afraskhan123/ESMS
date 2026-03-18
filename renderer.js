// ═══════════════════════════════════════════════════════════
// GLOBAL STATE & UTILITIES
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// LOGGING SYSTEM (PIPE CONSOLE TO ELECTRON-LOG)
// ═══════════════════════════════════════════════════════════
const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
};

console.log = (...args) => {
    originalConsole.log(...args);
    window.api.log('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

console.info = (...args) => {
    originalConsole.info(...args);
    window.api.log('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

console.warn = (...args) => {
    originalConsole.warn(...args);
    window.api.log('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

console.error = (...args) => {
    originalConsole.error(...args);
    window.api.log('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

console.debug = (...args) => {
    originalConsole.debug(...args);
    window.api.log('debug', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

let currentUser = null;
let allProducts = [];
let allCustomers = [];
let allSales = [];
let allInstallments = [];
let salesChart = null;

let lastReportContext = { type: null, args: [] };

let saleItemCounter = 0;
let saleCart = [];
let cartItemCounter = 0;
let currentPaymentsPage = 1;
const paymentsPageSize = 20;

let currentInstallmentsPage = 1;
const installmentsPageSize = 20;

let currentCustomersPage = 1;
const customersPageSize = 20;

// Utility: Debounce function to prevent rapid firing of heavy operations
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Utility: Print preview for invoices
window.previewInvoice = function () {
    window._printOriginalTitle = document.title;
    document.title = "Invoice preview"; // Or just keep it generic

    document.body.classList.add('printing-invoice');

    // Show the preview toolbar
    const toolbar = document.getElementById('print-preview-toolbar');
    if (toolbar) toolbar.classList.remove('hidden');

    // Scroll to top to see preview properly
    window.scrollTo(0, 0);
};

// Utility: Print list by temporarily adding printing-list class
window._printOriginalTitle = '';

window.printSpecialList = function (title = '') {
    // Optionally change the document title temporarily for the printed document name
    window._printOriginalTitle = document.title;
    if (title) document.title = title;

    document.body.classList.add('printing-list');

    // Show the preview toolbar
    const toolbar = document.getElementById('print-preview-toolbar');
    if (toolbar) toolbar.classList.remove('hidden');

    // Scroll to top to see preview properly
    window.scrollTo(0, 0);
};

window.cancelPrintPreview = function () {
    document.body.classList.remove('printing-list');
    document.body.classList.remove('printing-invoice');

    const toolbar = document.getElementById('print-preview-toolbar');
    if (toolbar) toolbar.classList.add('hidden');

    if (window._printOriginalTitle) document.title = window._printOriginalTitle;
};

window.confirmPrint = function () {
    // Use setTimeout to ensure any DOM updates before print triggers
    setTimeout(() => {
        window.print();
        // Remove class after printing
        cancelPrintPreview();
    }, 100);
};

// ═══════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');

    try {
        const result = await window.api.login({ username, password });

        if (result.success) {
            currentUser = result.admin;
            document.getElementById('current-user').textContent = currentUser.username;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app').classList.add('active');

            // Load initial data
            updateUserUI(); // Load profile UI
            await loadDashboard();
            await loadProducts();
            await loadCustomers();

            // Start auto-logout timer
            startInactivityTimer();

            // Initial alerts load
            loadAlerts();

            // Navigate to Sales tab by default after login
            const salesNavItem = document.querySelector('.nav-item[data-tab="sales"]');
            if (salesNavItem) salesNavItem.click();
        } else {
            errorDiv.querySelector('span').textContent = result.message;
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.querySelector('span').textContent = 'Login failed: ' + error.message;
        errorDiv.classList.remove('hidden');
    }
});

// Auto-logout after 30 minutes of inactivity
let inactivityTimer;
function startInactivityTimer() {
    const resetTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(logout, 30 * 60 * 1000); // 30 minutes
    };

    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keypress', resetTimer);
    resetTimer();
}

function logout() {
    currentUser = null;
    document.getElementById('app').classList.remove('active');
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    clearTimeout(inactivityTimer);
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const tab = item.dataset.tab;

        if (tab === 'logout') {
            logout();
            return;
        }

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            inventory: 'Inventory Management',
            customers: 'Customer Management',
            sales: 'Sales Management',
            installments: 'Installment Plans',
            payments: 'Payment Tracking',
            reports: 'Reports & Analytics',
            settings: 'Application Settings'
        };
        document.getElementById('page-title').textContent = titles[tab] || tab;

        // Load tab-specific data
        switch (tab) {
            case 'dashboard':
                loadDashboard();
                break;
            case 'inventory':
                loadProducts();
                break;
            case 'customers':
                loadCustomers();
                break;
            case 'sales':
                loadSalesTab();
                break;
            case 'installments':
                loadInstallments();
                break;
            case 'payments':
                currentPaymentsPage = 1;
                loadPaymentsTab();
                break;
            case 'reports':
                // Hide report output when switching back to the main tab
                const reportOutput = document.getElementById('report-output');
                if (reportOutput && !reportOutput.classList.contains('hidden')) {
                    reportOutput.classList.add('hidden');
                }
                // Always reset to Sales sub-tab
                const salesTabBtn = document.querySelector('.report-sub-tab[data-report-tab="sales"]');
                if (salesTabBtn) salesTabBtn.click();
                break;
            case 'settings':
                // No specific data to load for settings yet
                break;
        }
    });
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════

// Helper wrapper to trigger navigation from inline onclicks
window.navigateTab = function (tabId) {
    const tabEl = document.querySelector('.nav-item[data-tab="' + tabId + '"]');
    if (tabEl) tabEl.click();
};

window.navigateToSpecificReport = function (reportType) {
    if (reportType === 'low_stock') {
        window.navigateTab('inventory');
        // trigger low stock filter if the button is available and bound
        setTimeout(() => {
            const lowStockBtn = document.getElementById('low-stock-filter');
            if (lowStockBtn) lowStockBtn.click();
        }, 100);
        return;
    }

    if (reportType === 'pending_installments') {
        window.navigateTab('installments');
        // trigger All filter
        setTimeout(() => {
            const allFilter = document.querySelector('.installment-filter[data-status=""]');
            if (allFilter) allFilter.click();
        }, 100);
        return;
    }

    if (reportType === 'overdue_payments') {
        window.navigateTab('installments');
        // trigger Overdue filter
        setTimeout(() => {
            const overdueFilter = document.querySelector('.installment-filter[data-status="Overdue"]');
            if (overdueFilter) overdueFilter.click();
        }, 100);
        return;
    }

    // General reports navigation
    window.navigateTab('reports');

    // Slight delay to ensure tab switch completes before rendering report
    setTimeout(() => {
        if (reportType === 'daily') {
            document.querySelector('.report-sub-tab[data-report-tab="sales"]').click();
            document.getElementById('sales-report-type').value = 'daily';
            generateDailyReport();
        } else if (reportType === 'monthly') {
            document.querySelector('.report-sub-tab[data-report-tab="sales"]').click();
            document.getElementById('sales-report-type').value = 'monthly';
            generateMonthlyReport();
        }
    }, 100);
};

async function loadDashboard() {
    try {
        // Load stats
        const statsResult = await window.api.getDashboardStats();
        if (statsResult.success) {
            const stats = statsResult.stats;
            console.log('Dashboard stats:', stats); 


            const statsHTML = `
                <div class="stat-card hover-effect" onclick="navigateToSpecificReport('daily')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Daily Sales Report">
                    <div class="stat-icon"><i class="fas fa-calendar-day"></i></div>
                    <div class="stat-value">Rs. ${formatCurrency(stats.daily_sales)}</div>
                    <div class="stat-label">Today's Sales</div>
                </div>
                <div class="stat-card hover-effect" onclick="navigateToSpecificReport('monthly')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Monthly Sales Report">
                    <div class="stat-icon"><i class="fas fa-calendar-alt"></i></div>
                    <div class="stat-value">Rs. ${formatCurrency(stats.monthly_sales)}</div>
                    <div class="stat-label">Monthly Sales</div>
                </div>
                <div class="stat-card hover-effect" onclick="navigateToSpecificReport('pending_installments')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Installments Report">
                    <div class="stat-icon"><i class="fas fa-clock"></i></div>
                    <div class="stat-value">Rs. ${formatCurrency(stats.pending_installments)}</div>
                    <div class="stat-label">Pending Installments</div>
                </div>
                <div class="stat-card hover-effect" onclick="navigateToSpecificReport('overdue_payments')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Overdue Payments Report">
                    <div class="stat-icon"><i class="fas fa-exclamation-triangle"></i></div>
                    <div class="stat-value">${stats.overdue_count}</div>
                    <div class="stat-label">Overdue Payments</div>
                </div>
                <div class="stat-card hover-effect" onclick="navigateToSpecificReport('low_stock')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Low Stock Inventory">
                    <div class="stat-icon"><i class="fas fa-boxes"></i></div>
                    <div class="stat-value">${stats.low_stock_count}</div>
                    <div class="stat-label">Low Stock Items</div>
                </div>
                <div class="stat-card hover-effect" onclick="navigateTab('customers')" style="cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" title="View Customer Management">
                    <div class="stat-icon" style="color: var(--primary);"><i class="fas fa-users"></i></div>
                    <div class="stat-value">${stats.total_customers || 0}</div>
                    <div class="stat-label">Total Customers</div>
                </div>
            `;

            document.getElementById('stats-grid').innerHTML = statsHTML;
        }

        // Load alerts (updates both dashboard and header dropdown)
        await loadAlerts();
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// ═══════════════════════════════════════════════════════════
// INVENTORY MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function loadProducts(filters = {}) {
    try {
        const result = await window.api.getAllProducts(filters);
        if (result.success) {
            allProducts = result.products;

            // Re-apply search filter if present
            const searchInput = document.getElementById('product-search');
            const term = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : '';

            if (term) {
                const filtered = allProducts.filter(p =>
                    p.name.toLowerCase().includes(term) ||
                    (p.category && p.category.toLowerCase().includes(term)) ||
                    (p.brand && p.brand.toLowerCase().includes(term))
                );
                renderProductsTable(filtered);
            } else {
                renderProductsTable(allProducts);
            }

            // updateProductStats(allProducts); // Assuming this function exists elsewhere or will be added

            // Sync custom dropdowns with all categories/brands found in DB
            const dbCategories = [...new Set(allProducts.map(p => p.category).filter(Boolean))];
            let categoriesChanged = false;
            dbCategories.forEach(cat => {
                if (!categories.includes(cat)) {
                    categories.push(cat);
                    categoriesChanged = true;
                }
            });

            const dbBrands = [...new Set(allProducts.map(p => p.brand).filter(Boolean))];
            let brandsChanged = false;
            dbBrands.forEach(brand => {
                if (!brands.includes(brand)) {
                    brands.push(brand);
                    brandsChanged = true;
                }
            });

            // Update filters and dropdowns if data changed
            if (categoriesChanged || !document.getElementById('category-filter').options.length) {
                renderCategoryFilterOptions();
                renderDropdownList('category');
            }
            if (brandsChanged) renderDropdownList('brand');

            // Populate current-sale-product
            const productSelect = document.getElementById('current-sale-product');
            if (productSelect) {
                const currentVal = productSelect.value;
                productSelect.innerHTML = '<option value="">Select Product</option>' +
                    allProducts.map(p => {
                        return `<option value="${p.product_id}" data-price="${p.selling_price}" data-purchase-price="${p.purchase_price}" data-name="${p.name}" data-stock="${p.stock_qty}">${p.name}</option>`;
                    }).join('');
                if (allProducts.some(p => p.product_id == currentVal)) {
                    productSelect.value = currentVal;
                }
            }
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

function renderCategoryFilterOptions() {
    const categoryFilter = document.getElementById('category-filter');
    if (!categoryFilter) return;

    const currentValue = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All Categories</option>' +
        categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');

    // Restore selection if it still exists
    if (categories.includes(currentValue)) {
        categoryFilter.value = currentValue;
    }
}

function renderProductsTable(products) {
    const tbody = document.getElementById('products-tbody');

    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = products.map((product, index) => {
        const isLowStock = product.stock_qty <= product.min_stock_level;
        const stockClass = isLowStock ? 'text-danger fw-bold' : '';

        return `
        <tr>
            <td>${index + 1}</td>
            <td>${product.name}</td>
            <td>${product.category || '-'}</td>
            <td>${product.brand || '-'}</td>
            <td>Rs. ${formatCurrency(product.purchase_price)}</td>
            <td>Rs. ${formatCurrency(product.selling_price)}</td>
            <td class="${stockClass}">
                ${product.stock_qty}
                ${isLowStock ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
            </td>
            <td>${formatDate(product.last_updated || product.date_added)}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-primary" onclick="editProduct(${product.product_id})">
                    <i class="fas fa-edit"></i>
                </button>
                <!-- <button class="btn btn-sm btn-danger" onclick="deleteProduct(${product.product_id})">
                    <i class="fas fa-trash"></i>
                </button> -->
            </td>
        </tr>
    `}).join('');
}

// Product search
document.getElementById('product-search').addEventListener('input', debounce((e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = allProducts.filter(p =>
        p.name.toLowerCase().includes(searchTerm) ||
        (p.category && p.category.toLowerCase().includes(searchTerm)) ||
        (p.brand && p.brand.toLowerCase().includes(searchTerm))
    );
    renderProductsTable(filtered);
}, 300));

// Category filter
document.getElementById('category-filter').addEventListener('change', (e) => {
    const category = e.target.value;
    if (category) {
        loadProducts({ category });
    } else {
        loadProducts();
    }
});

// Low stock filter
document.getElementById('low-stock-filter').addEventListener('click', () => {
    loadProducts({ lowStock: true });
});

// ═══════════════════════════════════════════════════════════
// CUSTOM DROPDOWN MANAGEMENT
// ═══════════════════════════════════════════════════════════

let categories = ['Fridge', 'Washing Machine', 'Air Conditioner (AC)'].filter(v => v.trim() !== '');
let brands = ['Dawlance', 'Haier', 'PEL', 'Orient', 'Gree', 'Kenwood', 'Waves'].filter(v => v.trim() !== '');

function initCustomDropdowns() {
    renderDropdownList('category');
    renderDropdownList('brand');

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
            document.querySelectorAll('.custom-dropdown-input-area').forEach(i => i.classList.remove('active'));
        }
    });

    // Toggle dropdowns & handle typing
    ['category', 'brand'].forEach(type => {
        const display = document.getElementById(`${type}-display`);
        const dropdown = document.getElementById(`${type}-dropdown`);
        const input = document.getElementById(`${type}-input`);

        // Use capture phase or stop propagation carefully to prevent double-toggling
        const toggleDropdown = (e) => {
            e.stopPropagation();
            const isActive = dropdown.classList.contains('active');

            // Close all other dropdowns
            document.querySelectorAll('.custom-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('active');
            });

            // If we are clicking the input and it's already active, don't toggle off
            if (e.target === input && isActive) return;

            dropdown.classList.toggle('active');
        };

        display.addEventListener('click', toggleDropdown);

        // Input specific behavior: open on focus, sync value on input
        input.addEventListener('focus', () => {
            if (!dropdown.classList.contains('active')) {
                document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
                dropdown.classList.add('active');
            }
        });

        input.addEventListener('input', debounce((e) => {
            const val = e.target.value;
            document.getElementById(`product-${type}`).value = val;
            if (!dropdown.classList.contains('active')) dropdown.classList.add('active');
        }, 300));

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission
                const val = e.target.value.trim();
                if (val) {
                    const list = type === 'category' ? categories : brands;
                    if (!list.includes(val)) {
                        list.push(val);
                        renderDropdownList(type);
                    }
                    selectDropdownItem(type, val);
                    dropdown.classList.remove('active');
                }
            }
        });

        // Add New Input Enter Key Handling
        document.getElementById(`${type}-new-input`).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission
                document.getElementById(`${type}-new-save`).click(); // Trigger the add button
            }
        });

        // Add New trigger
        document.getElementById(`${type}-add-new`).addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown-input-area').forEach(i => i.classList.remove('active'));
            document.getElementById(`${type}-input-area`).classList.add('active');
            document.getElementById(`${type}-new-input`).focus();
        });

        // Save New
        document.getElementById(`${type}-new-save`).addEventListener('click', (e) => {
            e.stopPropagation();
            const inputField = document.getElementById(`${type}-new-input`);
            const val = inputField.value.trim();
            if (val) {
                const list = type === 'category' ? categories : brands;
                if (!list.includes(val)) {
                    list.push(val);
                    renderDropdownList(type);
                }
                selectDropdownItem(type, val);
                inputField.value = '';
                document.getElementById(`${type}-input-area`).classList.remove('active');
                document.getElementById(`${type}-dropdown`).classList.remove('active');
            }
        });
    });
}

function renderDropdownList(type) {
    const listContainer = document.getElementById(`${type}-list`);
    const addNew = document.getElementById(`${type}-add-new`);
    let items = type === 'category' ? categories : brands;

    // Clean up lists (remove empty strings)
    items = items.filter(v => v && v.trim() !== '');
    if (type === 'category') categories = items; else brands = items;

    // Clear existing items (keep add-new and input-area)
    const existingItems = listContainer.querySelectorAll('.custom-dropdown-item:not(.custom-dropdown-add-new)');
    existingItems.forEach(item => item.remove());

    items.forEach(val => {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-item';
        item.innerHTML = `
            <span class="custom-dropdown-item-text" title="${val}">${val}</span>
            <div class="custom-dropdown-actions">
                <i class="fas fa-edit custom-dropdown-action edit" title="Edit"></i>
                <i class="fas fa-trash custom-dropdown-action delete" title="Delete"></i>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('.custom-dropdown-action') || item.classList.contains('editing')) return;
            selectDropdownItem(type, val);
            document.getElementById(`${type}-dropdown`).classList.remove('active');
        });

        const textSpan = item.querySelector('.custom-dropdown-item-text');
        const editBtn = item.querySelector('.edit');

        const startEdit = (e) => {
            e.stopPropagation();
            if (item.classList.contains('editing')) return;

            item.classList.add('editing');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'custom-dropdown-item-edit-input';
            input.value = val;

            const originalActions = item.querySelector('.custom-dropdown-actions');
            originalActions.style.display = 'none';

            const saveEdit = () => {
                const newValue = input.value.trim();
                item.classList.remove('editing');
                originalActions.style.display = 'flex';

                if (newValue && newValue !== val) {
                    const list = type === 'category' ? categories : brands;
                    const index = list.indexOf(val);
                    if (index > -1) {
                        list[index] = newValue;
                        renderDropdownList(type);
                        if (document.getElementById(`product-${type}`).value === val) {
                            selectDropdownItem(type, newValue);
                        }
                    }
                } else {
                    renderDropdownList(type);
                }
            };

            input.onclick = (ev) => ev.stopPropagation();
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault(); // Prevent modal form submission
                    saveEdit();
                }
                if (ev.key === 'Escape') {
                    item.classList.remove('editing');
                    originalActions.style.display = 'flex';
                    input.remove();
                }
            };
            input.onblur = saveEdit;

            item.insertBefore(input, originalActions);
            input.focus();
        };

        editBtn.addEventListener('click', startEdit);
        // textSpan.addEventListener('click', startEdit); // Removed to allow selection on click

        const deleteBtn = item.querySelector('.delete');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const list = type === 'category' ? categories : brands;
            const index = list.indexOf(val);
            if (index > -1) {
                list.splice(index, 1);
                renderDropdownList(type);

                // If the currently selected item in the form is the one being deleted, clear the field
                const hiddenInput = document.getElementById(`product-${type}`);
                const visibleInput = document.getElementById(`${type}-input`);
                if (hiddenInput && hiddenInput.value === val) {
                    hiddenInput.value = '';
                }
                if (visibleInput && visibleInput.value === val) {
                    visibleInput.value = '';
                }
            }
        });

        listContainer.insertBefore(item, addNew);
    });

    if (type === 'category') {
        renderCategoryFilterOptions();
    }
}

function selectDropdownItem(type, val) {
    const input = document.getElementById(`${type}-input`);
    const hiddenInput = document.getElementById(`product-${type}`);
    if (hiddenInput) hiddenInput.value = val;
    if (input) {
        input.value = val;
    }
}

// Call initialization
initCustomDropdowns();
initSalesCustomerDropdown();

function initSalesCustomerDropdown() {
    const dropdown = document.getElementById('sale-customer-dropdown');
    const input = document.getElementById('sale-customer-input');
    const display = document.getElementById('sale-customer-display');

    if (!dropdown || !input || !display) return;

    display.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) {
            input.focus();
        }
    });

    input.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filtered = allCustomers.filter(c => 
            c.full_name.toLowerCase().includes(searchTerm) || 
            (c.id_number && c.id_number.toLowerCase().includes(searchTerm)) ||
            (c.phone && c.phone.includes(searchTerm))
        );
        renderSaleCustomerDropdownList(filtered);
        if (!dropdown.classList.contains('active')) dropdown.classList.add('active');
    });

    input.addEventListener('focus', () => {
        if (!dropdown.classList.contains('active')) {
            dropdown.classList.add('active');
            renderSaleCustomerDropdownList(allCustomers);
        }
    });
}

function renderSaleCustomerDropdownList(customers) {
    const list = document.getElementById('sale-customer-list');
    if (!list) return;

    list.innerHTML = '';

    // Add Walk-in option first
    const walkinItem = document.createElement('div');
    walkinItem.className = 'custom-dropdown-item';
    walkinItem.innerHTML = '<span class="custom-dropdown-item-text" style="font-weight: bold; color: #27ae60;">Walk-in Customer (Direct Purchase)</span>';
    walkinItem.addEventListener('click', () => {
        selectSaleCustomer(null);
        document.getElementById('sale-customer-dropdown').classList.remove('active');
    });
    list.appendChild(walkinItem);

    customers.forEach(customer => {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-item';
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="custom-dropdown-item-text" style="font-weight: 600; color: #1e293b;">${customer.full_name}</span>
                <span style="font-size: 0.7rem; background: #e2e8f0; color: #475569; padding: 2px 8px; border-radius: 12px; font-family: monospace; white-space: nowrap; margin-left: 10px;">${customer.id_number || 'No ID'}</span>
            </div>
        `;
        item.addEventListener('click', () => {
            selectSaleCustomer(customer);
            document.getElementById('sale-customer-dropdown').classList.remove('active');
        });
        list.appendChild(item);
    });
}

function selectSaleCustomer(customer) {
    const input = document.getElementById('sale-customer-input');
    const hiddenInput = document.getElementById('sale-customer');
    const walkinGroup = document.getElementById('walkin-name-group');

    if (customer) {
        input.value = customer.full_name;
        hiddenInput.value = customer.customer_id;
        walkinGroup.classList.add('hidden');
        document.getElementById('walkin-name').required = false;
        document.getElementById('walkin-name').value = '';
    } else {
        input.value = 'Walk-in Customer';
        hiddenInput.value = '0';
        walkinGroup.classList.remove('hidden');
        document.getElementById('walkin-name').required = true;
    }

    // Trigger internal change logic
    const event = new Event('change', { bubbles: true });
    hiddenInput.dispatchEvent(event);
}

// Open Settings (via Admin Profile)
document.getElementById('admin-profile-btn').addEventListener('click', () => {
    document.querySelector('.nav-item[data-tab="settings"]').click();
});

// Restoration of add-product-btn
document.getElementById('add-product-btn').addEventListener('click', () => {
    document.getElementById('product-modal-title').textContent = 'Add Product';
    document.getElementById('product-form').reset();
    document.getElementById('product-id').value = '';
    selectDropdownItem('category', '');
    selectDropdownItem('brand', '');
    openModal('product-modal');
});

// Product form submit
document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Ensure hidden inputs are synced with visible inputs for custom dropdowns
    const categoryInput = document.getElementById('category-input').value;
    const brandInput = document.getElementById('brand-input').value;
    document.getElementById('product-category').value = categoryInput;
    document.getElementById('product-brand').value = brandInput;

    const productData = {
        name: document.getElementById('product-name').value,
        category: categoryInput,
        brand: brandInput,
        purchase_price: parseFloat(document.getElementById('product-purchase-price').value),
        selling_price: parseFloat(document.getElementById('product-selling-price').value),
        stock_qty: parseInt(document.getElementById('product-stock').value),
        min_stock_level: parseInt(document.getElementById('product-min-stock').value),
        supplier_name: document.getElementById('product-supplier').value,
        warranty_period: document.getElementById('product-warranty').value
    };

    if (productData.purchase_price < 0 || productData.selling_price < 0 || productData.stock_qty < 0 || productData.min_stock_level < 0) {
        showNotification('error', 'Product values cannot be negative');
        return;
    }

    const productId = document.getElementById('product-id').value;

    try {
        let result;
        if (productId) {
            productData.product_id = parseInt(productId);
            result = await window.api.updateProduct(productData);
        } else {
            result = await window.api.addProduct(productData);
        }

        if (result.success) {
            closeModal('product-modal');
            loadProducts();
            showNotification('success', result.message);
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error saving product: ' + error.message);
    }
});

function editProduct(productId) {
    const product = allProducts.find(p => p.product_id === productId);
    if (!product) return;

    const form = document.getElementById('product-form');
    form.reset();

    document.getElementById('product-modal-title').textContent = 'Edit Product';
    document.getElementById('product-id').value = product.product_id;
    document.getElementById('product-name').value = product.name;

    // Handle Category Dropdown
    const categoryValue = product.category || '';
    if (categoryValue && !categories.includes(categoryValue)) {
        categories.push(categoryValue);
        renderDropdownList('category');
    }
    selectDropdownItem('category', categoryValue);

    // Handle Brand Dropdown
    const brandValue = product.brand || '';
    if (brandValue && !brands.includes(brandValue)) {
        brands.push(brandValue);
        renderDropdownList('brand');
    }
    selectDropdownItem('brand', brandValue);

    document.getElementById('product-purchase-price').value = product.purchase_price;
    document.getElementById('product-selling-price').value = product.selling_price;
    document.getElementById('product-stock').value = product.stock_qty;
    document.getElementById('product-min-stock').value = product.min_stock_level;
    document.getElementById('product-supplier').value = product.supplier_name || '';
    document.getElementById('product-warranty').value = product.warranty_period || '';

    openModal('product-modal');
}

async function deleteProduct(productId) {
    const isConfirmed = await appConfirm('Are you sure you want to delete this product?');
    if (!isConfirmed) return;

    try {
        const result = await window.api.deleteProduct(productId);
        if (result.success) {
            loadProducts();
            showNotification('success', result.message);
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error deleting product: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════
// CUSTOMER MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function loadCustomers() {
    try {
        const result = await window.api.getAllCustomers();
        if (result.success) {
            allCustomers = result.customers;
            currentCustomersPage = 1;
            renderCustomersTable(allCustomers);
            renderSaleCustomerDropdownList(allCustomers);
            
            // Duplicate ID Detection (Active records only)
            const idCounts = {};
            allCustomers.forEach(c => {
                const id = c.id_number;
                if (id && id.trim() !== '' && c.is_deleted === 0) {
                    idCounts[id] = (idCounts[id] || 0) + 1;
                }
            });
            const duplicates = Object.keys(idCounts).filter(id => idCounts[id] > 1);
            if (duplicates.length > 0) {
                const dupMsg = duplicates.map(id => `ID '${id}' (${idCounts[id]} times)`).join(', ');
                showNotification('error', `Duplicate ID Numbers found: ${dupMsg}. Please clean these up for security.`);
            }
        }

            // Update Total Count in Bottom Footer
            const totalCountBottom = document.getElementById('customer-total-count-bottom');
            if (totalCountBottom) {
                totalCountBottom.textContent = allCustomers ? allCustomers.length : 0;
            }
    } catch (error) {
        console.error('Error loading customers:', error);
    }
}

function renderCustomersTable(customers, page = null) {
    const tbody = document.getElementById('customers-tbody');
    const paginationDiv = document.getElementById('customers-pagination');

    if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No customers found</td></tr>';
        if (paginationDiv) paginationDiv.classList.add('hidden');
        return;
    }

    const totalPages = Math.max(1, Math.ceil(customers.length / customersPageSize));
    if (page !== null) currentCustomersPage = page;
    if (currentCustomersPage > totalPages) currentCustomersPage = totalPages;

    const startIdx = (currentCustomersPage - 1) * customersPageSize;
    const pagedCustomers = customers.slice(startIdx, startIdx + customersPageSize);

    tbody.innerHTML = pagedCustomers.map((customer, index) => {
        const displayIndex = startIdx + index + 1;
        return `
        <tr>
            <td>${displayIndex}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${customer.image_path || 'assets/default-avatar.png'}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid #ccc;">
                    ${customer.full_name}
                </div>
            </td>
            <td>${customer.phone}</td>
            <td>${customer.address || '-'}</td>
            <td>${customer.id_number || '-'}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-info" onclick="viewCustomerDetail(${customer.customer_id})" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-primary" onclick="editCustomer(${customer.customer_id})" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-success" onclick="viewCustomerHistory(${customer.customer_id})" title="Purchase History">
                    <i class="fas fa-history"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteCustomer(${customer.customer_id})" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `}).join('');

    // Render pagination controls
    if (paginationDiv) {
        if (totalPages <= 1) {
            paginationDiv.classList.add('hidden');
        } else {
            paginationDiv.classList.remove('hidden');
            paginationDiv.innerHTML = `
                <button class="btn btn-secondary btn-sm" id="cust-prev-page" ${currentCustomersPage <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
                <span class="report-page-info">Page ${currentCustomersPage} of ${totalPages}</span>
                <button class="btn btn-secondary btn-sm" id="cust-next-page" ${currentCustomersPage >= totalPages ? 'disabled' : ''}>
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            `;

            // Add event listeners
            document.getElementById('cust-prev-page')?.addEventListener('click', () => {
                if (currentCustomersPage > 1) {
                    currentCustomersPage--;
                    renderCustomersTable(customers);
                }
            });

            document.getElementById('cust-next-page')?.addEventListener('click', () => {
                if (currentCustomersPage < totalPages) {
                    currentCustomersPage++;
                    renderCustomersTable(customers);
                }
            });
        }
    }
}

function viewCustomerDetail(customerId) {
    const customer = allCustomers.find(c => c.customer_id === customerId);
    if (!customer) return;

    document.getElementById('detail-customer-image').src = customer.image_path || 'assets/default-avatar.png';
    document.getElementById('detail-customer-name').textContent = customer.full_name;
    document.getElementById('detail-customer-phone').textContent = customer.phone;
    document.getElementById('detail-customer-id').textContent = customer.id_number || '-';
    document.getElementById('detail-customer-email').textContent = customer.email || '-';
    document.getElementById('detail-customer-address').textContent = customer.address || '-';

    openModal('customer-detail-modal');
}

// Customer search
document.getElementById('customer-search').addEventListener('input', debounce((e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = allCustomers.filter(c =>
        c.full_name.toLowerCase().includes(searchTerm) ||
        c.phone.includes(searchTerm) ||
        (c.id_number && c.id_number.toLowerCase().includes(searchTerm))
    );
    currentCustomersPage = 1; // Reset to page 1 on new search
    renderCustomersTable(filtered);
}, 300));

// Add customer button
document.getElementById('add-customer-btn').addEventListener('click', () => {
    document.getElementById('customer-modal-title').textContent = 'Add Customer';
    document.getElementById('customer-form').reset();
    document.getElementById('customer-id').value = '';
    document.getElementById('customer-image-preview').src = 'assets/default-avatar.png';
    document.getElementById('customer-image-upload').dataset.filepath = '';
    openModal('customer-modal', 'customer-name');
});

// Customer Image Upload Preview
document.getElementById('customer-image-upload').addEventListener('change', function (e) {
    if (this.files && this.files[0]) {
        const file = this.files[0];
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('customer-image-preview').src = e.target.result;
            // Store the Base64 data for submission
            document.getElementById('customer-image-upload').dataset.base64 = e.target.result;
        }
        reader.readAsDataURL(file);
    }
});

// Customer form submit
document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const customerData = {
        fullName: document.getElementById('customer-name').value,
        phone: document.getElementById('customer-phone').value,
        address: document.getElementById('customer-address').value,
        idNumber: document.getElementById('customer-id-number').value,
        email: document.getElementById('customer-email').value,
        imageData: document.getElementById('customer-image-upload').dataset.base64 || null
    };

    const customerId = document.getElementById('customer-id').value;

    try {
        let result;
        if (customerId) {
            customerData.customer_id = parseInt(customerId);
            result = await window.api.updateCustomer(customerData);
        } else {
            result = await window.api.addCustomer(customerData);
        }

        if (result.success) {
            closeModal('customer-modal');
            loadCustomers();
            showNotification('success', result.message);
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error saving customer: ' + error.message);
    }
});

function editCustomer(customerId) {
    const customer = allCustomers.find(c => c.customer_id === customerId);
    if (!customer) return;

    document.getElementById('customer-modal-title').textContent = 'Edit Customer';
    document.getElementById('customer-id').value = customer.customer_id;
    document.getElementById('customer-name').value = customer.full_name;
    document.getElementById('customer-phone').value = customer.phone;
    document.getElementById('customer-address').value = customer.address || '';
    document.getElementById('customer-id-number').value = customer.id_number || '';
    document.getElementById('customer-email').value = customer.email || '';

    const imagePreview = document.getElementById('customer-image-preview');
    const imageUpload = document.getElementById('customer-image-upload');

    if (customer.image_path) {
        // Use the Base64 from backend or show via file protocol if it's still a path (fallback)
        imagePreview.src = customer.image_path.startsWith('data:') ? customer.image_path : 'file:///' + customer.image_path.replace(/\\/g, '/');
    } else {
        imagePreview.src = 'assets/default-avatar.png';
        delete imageUpload.dataset.base64;
    }
    imageUpload.value = ''; // Clear the file input itself

    openModal('customer-modal', 'customer-name');
}

async function deleteCustomer(customerId) {
    const isConfirmed = await appConfirm('Are you sure you want to delete this customer?');
    if (!isConfirmed) return;

    try {
        const result = await window.api.deleteCustomer(customerId);
        if (result.success) {
            loadCustomers();
            loadDashboard(); // Refresh the dashboard totals after cascade deletion
            showNotification('success', result.message);
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error deleting customer: ' + error.message);
    }
}

async function viewCustomerHistory(customerId) {
    try {
        const result = await window.api.getCustomerHistory(customerId);
        if (result.success) {
            const customer = allCustomers.find(c => c.customer_id === customerId);
            // Sort sales in descending order (newest first)
            const sales = result.sales.sort((a, b) => b.sale_id - a.sale_id);

            let historyHTML = `
                <div class="printable-invoice">
                    <h2 style="text-align: center; margin-bottom: 2rem; color: #2c3e50; font-size: 1.8rem; font-weight: 700;">
                        ${customer.full_name}'s Purchase History
                    </h2>
            `;

            if (sales.length === 0) {
                historyHTML += '<p class="text-muted" style="text-align: center; padding: 2rem;">No purchase history</p>';
            } else {
                historyHTML += '<div style="display: grid; gap: 1rem; margin-bottom: 2rem;">';

                sales.forEach((sale, index) => {
                    let status = sale.payment_type === 'Cash' ? 'Paid' :
                        (sale.installment ? sale.installment.status : 'N/A');

                    const statusColor = status === 'Paid' ? '#27ae60' :
                        status === 'Completed' ? '#27ae60' :
                            status === 'Active' ? '#3498db' :
                                status === 'Overdue' ? '#e74c3c' : '#95a5a6';

                    historyHTML += `
                        <div style="background: #f8f9fa; border-radius: 8px; padding: 1.5rem; border-left: 4px solid ${statusColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center;">
                            <div style="background: ${statusColor}; color: white; width: 45px; height: 45px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem; flex-shrink: 0;">
                                ${index + 1}
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 1rem; align-items: center;">
                                <div>
                                    <div style="color: #7f8c8d; font-size: 0.85rem; margin-bottom: 0.25rem;">Invoice #${sale.sale_id}</div>
                                    <div style="color: #2c3e50; font-weight: 600;">${formatDate(sale.sale_date)}</div>
                                </div>
                                <div>
                                    <div style="color: #7f8c8d; font-size: 0.85rem; margin-bottom: 0.25rem;">Items</div>
                                    <div style="color: #2c3e50; font-weight: 500;">${sale.items || 'N/A'}</div>
                                </div>
                                <div>
                                    <div style="color: #7f8c8d; font-size: 0.85rem; margin-bottom: 0.25rem;">Amount</div>
                                    <div style="color: #2c3e50; font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">Rs. ${formatCurrency(sale.total_amount)}</div>
                                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                                        <span style="background: ${sale.payment_type === 'Cash' ? '#d4edda' : '#fff3cd'}; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; color: ${sale.payment_type === 'Cash' ? '#155724' : '#856404'};">
                                            ${sale.payment_type}
                                        </span>
                                        <span style="background: ${statusColor}; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; color: white;">
                                            ${status}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <button class="btn btn-primary btn-sm" onclick="viewInvoice(${sale.sale_id})" style="white-space: nowrap;">
                                        <i class="fas fa-file-invoice"></i> View Invoice
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });

                historyHTML += '</div>';
            }

            historyHTML += '</div>';
            document.getElementById('invoice-content').innerHTML = historyHTML;
            openModal('invoice-modal');
        }
    } catch (error) {
        showNotification('error', 'Error loading customer history: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════
// SALES MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function loadSalesTab() {
    // Load recent sales
    try {
        const result = await window.api.getAllSales();
        if (result.success) {
            allSales = result.sales;

            // Re-apply search filter if present
            const searchInput = document.getElementById('search-sales');
            const searchBtnInput = document.getElementById('search-sales-input'); // Just in case
            const term = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : '';

            if (term) {
                const filteredSales = allSales.filter(sale =>
                    (sale.customer_name && sale.customer_name.toLowerCase().includes(term)) ||
                    sale.sale_id.toString().includes(term)
                );
                renderSalesTable(filteredSales);
            } else {
                renderSalesTable(allSales); // Default render
            }

            // updateSalesSummary(allSales); // Assuming this function exists elsewhere or will be added
        }
    } catch (error) {
        console.error('Error loading sales:', error);
    }
}

// Clear Sales History
document.getElementById('clear-history-btn').addEventListener('click', async () => {
    const isConfirmed = await appConfirm('Are you sure you want to delete ALL sales history? This action cannot be undone and will remove all sales, items, and installment records.', 'Warning: Delete ALL Sales?');

    if (isConfirmed) {
        try {
            const result = await window.api.deleteAllSales();
            if (result.success) {
                showNotification('success', result.message);
                loadSalesTab();
                loadDashboard();
                loadInstallments(); // Also refresh installments as they are deleted cascadingly
            } else {
                showNotification('error', result.message);
            }
        } catch (error) {
            showNotification('error', 'Error clearing history: ' + error.message);
        }
    }
});

function renderSalesTable(sales) {
    const tbody = document.getElementById('sales-tbody');

    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No sales found</td></tr>';
        return;
    }

    // Sort sales in descending order (newest first) and take the top 20
    const sortedSales = [...sales].sort((a, b) => b.sale_id - a.sale_id);

    tbody.innerHTML = sortedSales.slice(0, 20).map((sale, index) => `
        <tr>
            <td>#${sale.sale_id} ${sale.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${sale.sale_id})" style="font-size: 0.6rem; padding: 2px 4px; cursor: pointer;" title="Click to view return details">Returned</span>` : ''}</td>
            <td>${sale.customer_name || 'Walk-in Customer'}</td>
            <td>${formatDate(sale.sale_date)}</td>
            <td>Rs. ${formatCurrency(sale.total_amount)}</td>
            <td><span class="badge badge-${sale.payment_type === 'Cash' ? 'success' : 'primary'}">${sale.payment_type}</span></td>
            <td class="table-actions">
                <button class="btn btn-sm btn-primary" onclick="viewInvoice(${sale.sale_id})" title="View Invoice">
                    <i class="fas fa-file-invoice"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="openReturnModal(${sale.sale_id})" title="Process Return">
                    <i class="fas fa-undo"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Payment type change
document.getElementById('payment-type').addEventListener('change', (e) => {
    const installmentDetails = document.getElementById('installment-details');
    const isInstallment = e.target.value === 'Installment';
    if (isInstallment) {
        installmentDetails.classList.remove('hidden');
        // Pre-fill the date picker with today as a convenient default
        const defaultDate = new Date();
        document.getElementById('installment-start-date').value = defaultDate.toISOString().split('T')[0];
    } else {
        installmentDetails.classList.add('hidden');
    }

    const subLabel = document.getElementById('current-sale-subtotal-label');
    if (subLabel) {
        subLabel.textContent = isInstallment ? 'Installment Price' : 'Subtotal';
    }

    renderSaleCart();
});

// Current sale item inputs
document.getElementById('current-sale-product').addEventListener('change', (e) => {
    document.getElementById('current-sale-subtotal').dataset.custom = 'false';
    calculateCurrentSaleItemSubtotal();
});

document.getElementById('current-sale-quantity').addEventListener('input', debounce(() => {
    document.getElementById('current-sale-subtotal').dataset.custom = 'false';
    calculateCurrentSaleItemSubtotal();
}, 300));

const curSubtotalInput = document.getElementById('current-sale-subtotal');
curSubtotalInput.addEventListener('dblclick', (e) => {
    e.target.removeAttribute('readonly');
    let val = e.target.value.replace('Rs. ', '').replace(/,/g, '');
    e.target.value = val;
    e.target.focus();
});
curSubtotalInput.addEventListener('blur', (e) => {
    e.target.setAttribute('readonly', 'readonly');
    const parsedVal = parseFloat(e.target.value.replace('Rs. ', '').replace(/,/g, ''));
    if (!isNaN(parsedVal) && parsedVal >= 0) {
        e.target.dataset.custom = 'true';
    } else {
        e.target.dataset.custom = 'false';
    }
    calculateCurrentSaleItemSubtotal();
});
curSubtotalInput.addEventListener('input', debounce((e) => {
    e.target.dataset.custom = 'true';
    calculateCurrentSaleItemSubtotal();
}, 300));

function calculateCurrentSaleItemSubtotal() {
    const productSelect = document.getElementById('current-sale-product');
    const quantityInput = document.getElementById('current-sale-quantity');
    const subtotalInput = document.getElementById('current-sale-subtotal');
    const errorDiv = document.getElementById('current-sale-stock-error');

    errorDiv.classList.add('hidden');
    quantityInput.classList.remove('is-invalid');

    if (productSelect.value && quantityInput.value) {
        const productId = parseInt(productSelect.value);
        const product = allProducts.find(p => p.product_id === productId);
        const price = parseFloat(productSelect.selectedOptions[0].dataset.price);
        const quantity = parseInt(quantityInput.value);

        const cartQty = saleCart.filter(item => item.product_id === productId).reduce((sum, item) => sum + item.quantity, 0);

        if (product && (quantity + cartQty) > product.stock_qty) {
            quantityInput.classList.add('is-invalid');
            errorDiv.querySelector('span').textContent = `Only ${product.stock_qty} in stock (${cartQty} already in cart)`;
            errorDiv.classList.remove('hidden');
        }

        let subtotal = price * quantity;
        if (subtotalInput.dataset.custom === 'true') {
            const parsedVal = parseFloat(subtotalInput.value.replace('Rs. ', '').replace(/,/g, ''));
            if (!isNaN(parsedVal) && parsedVal >= 0) subtotal = parsedVal;
        }

        if (subtotalInput.hasAttribute('readonly')) {
            subtotalInput.value = `Rs. ${formatCurrency(subtotal)}`;
        }
    } else {
        subtotalInput.value = `Rs. 0.00`;
    }

    // Trigger installment calculation preview if payment type is 'Installment'
    if (document.getElementById('payment-type') && document.getElementById('payment-type').value === 'Installment') {
        const cartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
        const currentSubtotal = parseFloat(subtotalInput.value.replace('Rs. ', '').replace(/,/g, '')) || 0;
        updateInstallmentCalculation(cartTotal + currentSubtotal);
    }
}

// Clear unsaved item from Add Product section
document.getElementById('clear-cart-item-btn').addEventListener('click', () => {
    const productSelect = document.getElementById('current-sale-product');
    const quantityInput = document.getElementById('current-sale-quantity');
    const subtotalInput = document.getElementById('current-sale-subtotal');
    const errorDiv = document.getElementById('current-sale-stock-error');

    // If this was triggered from an edit (item was removed from cart), we need to put it back.
    // Since we can't recover the original item easily after splice, we just clear the form.
    productSelect.value = '';
    quantityInput.value = '1';
    subtotalInput.value = 'Rs. 0.00';
    subtotalInput.dataset.custom = 'false';
    errorDiv.classList.add('hidden');
    quantityInput.classList.remove('is-invalid');
    calculateCurrentSaleItemSubtotal();
});

// Add sale item
document.getElementById('add-to-cart-btn').addEventListener('click', () => {
    const productSelect = document.getElementById('current-sale-product');
    const quantityInput = document.getElementById('current-sale-quantity');
    const subtotalInput = document.getElementById('current-sale-subtotal');
    const errorDiv = document.getElementById('current-sale-stock-error');

    if (!productSelect.value || !quantityInput.value) {
        showNotification('error', 'Please select a product and enter quantity');
        return;
    }

    const productId = parseInt(productSelect.value);
    const product = allProducts.find(p => p.product_id === productId);
    const quantity = parseInt(quantityInput.value);
    const price = parseFloat(productSelect.selectedOptions[0].dataset.price);
    const purchasePrice = parseFloat(productSelect.selectedOptions[0].dataset.purchasePrice) || 0;
    const name = productSelect.selectedOptions[0].dataset.name;

    const parsedSubtotal = parseFloat(subtotalInput.value.replace('Rs. ', '').replace(/,/g, ''));
    if (isNaN(parsedSubtotal) || parsedSubtotal < 0) {
        showNotification('error', 'Invalid subtotal');
        return;
    }

    const cartQty = saleCart.filter(item => item.product_id === productId).reduce((sum, item) => sum + item.quantity, 0);
    if (product && (quantity + cartQty) > product.stock_qty) {
        showNotification('error', 'Not enough stock available');
        return;
    }

    // Validate Down Payment for Installment
    if (document.getElementById('payment-type') && document.getElementById('payment-type').value === 'Installment') {
        const currentDownPayment = parseFloat(document.getElementById('down-payment').value) || 0;
        const currentCartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
        const projectedTotal = currentCartTotal + parsedSubtotal;

        if (currentDownPayment > projectedTotal) {
            showNotification('error', 'Down payment cannot exceed the total installment price');
            return;
        }
    }

    cartItemCounter++;
    saleCart.push({
        id: cartItemCounter,
        product_id: productId,
        product_name: name,
        quantity: quantity,
        unit_price: price,
        purchase_price: purchasePrice,
        subtotal: parsedSubtotal
    });

    productSelect.value = '';
    quantityInput.value = '1';
    subtotalInput.value = 'Rs. 0.00';
    subtotalInput.dataset.custom = 'false';
    errorDiv.classList.add('hidden');
    quantityInput.classList.remove('is-invalid');
    calculateCurrentSaleItemSubtotal();
    // Recalculate monthly payment after adding item
    if (document.getElementById('payment-type').value === 'Installment') {
        const cartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
        updateInstallmentCalculation(cartTotal);

        // Auto-navigate to the cart visually
        document.getElementById('sale-cart-table').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    renderSaleCart();
});

function renderSaleCart() {
    const tbody = document.getElementById('sale-cart-tbody');
    if (saleCart.length === 0) {
        tbody.innerHTML = '<tr id="empty-cart-row"><td colspan="5" class="text-center text-muted">No items added yet</td></tr>';
        document.getElementById('sale-total').textContent = 'Rs. 0.00';
        updateInstallmentCalculation(0);

        const submitBtn = document.querySelector('#sale-form button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    let total = 0;
    tbody.innerHTML = saleCart.map(item => {
        total += item.subtotal;
        return `
        <tr>
            <td>${item.product_name}</td>
            <td>Rs. ${formatCurrency(item.unit_price)}</td>
            <td>${item.quantity}</td>
            <td>Rs. ${formatCurrency(item.subtotal)}</td>
            <td class="table-actions">
                <button type="button" class="btn btn-sm btn-primary" onclick="editCartItem(${item.id})"><i class="fas fa-edit"></i></button>
                <button type="button" class="btn btn-sm btn-danger" onclick="removeCartItem(${item.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
        `;
    }).join('');

    document.getElementById('sale-total').textContent = `Rs. ${formatCurrency(total)}`;
    updateInstallmentCalculation(total);

    const submitBtn = document.querySelector('#sale-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;
}

window.removeCartItem = async function (id) {
    saleCart = saleCart.filter(item => item.id !== id);
    renderSaleCart();
    calculateCurrentSaleItemSubtotal(); // Re-validate current inputs
};

window.editCartItem = function (id) {
    const productSelect = document.getElementById('current-sale-product');
    const quantityInput = document.getElementById('current-sale-quantity');
    const subtotalInput = document.getElementById('current-sale-subtotal');
    const addToCartBtn = document.getElementById('add-to-cart-btn');

    // If there's an active, unsaved item sitting in the inputs, add it to the cart before pulling the new edit item.
    if (productSelect.value && quantityInput.value) {
        addToCartBtn.click();

        // Ensure the add didn't fail due to stock/validation errors before proceeding
        if (productSelect.value) {
            showNotification('error', 'Cannot edit new item until current item errors are resolved.');
            return;
        }
    }

    const index = saleCart.findIndex(item => item.id === id);
    if (index === -1) return;
    const item = saleCart[index];

    // Convert product_id to string to ensure the option is properly selected
    productSelect.value = String(item.product_id);
    quantityInput.value = item.quantity;

    // Set custom dataset BEFORE setting the value, so the value displays correctly
    const defaultSubtotal = item.unit_price * item.quantity;
    subtotalInput.dataset.custom = (Math.abs(defaultSubtotal - item.subtotal) > 0.01) ? 'true' : 'false';
    subtotalInput.value = `Rs. ${formatCurrency(item.subtotal)}`;

    saleCart.splice(index, 1);
    renderSaleCart();
    calculateCurrentSaleItemSubtotal();    // Recalculate monthly payment preview
    if (document.getElementById('payment-type').value === 'Installment') {
        const cartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
        updateInstallmentCalculation(cartTotal);
    }

    // Visually navigate the user up to the "Add Product" section of the Sales tab
    document.getElementById('sale-item-input-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
    quantityInput.focus();
};

document.getElementById('down-payment').addEventListener('input', debounce(() => {
    const cartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
    const currentSubtotal = parseFloat(document.getElementById('current-sale-subtotal').value.replace('Rs. ', '').replace(/,/g, '')) || 0;
    updateInstallmentCalculation(cartTotal + currentSubtotal);
}, 300));

document.getElementById('installment-duration').addEventListener('input', debounce(() => {
    const cartTotal = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
    const currentSubtotal = parseFloat(document.getElementById('current-sale-subtotal').value.replace('Rs. ', '').replace(/,/g, '')) || 0;
    updateInstallmentCalculation(cartTotal + currentSubtotal);
}, 300));

function updateInstallmentCalculation(totalAmount) {
    const downPaymentInput = document.getElementById('down-payment');
    const durationInput = document.getElementById('installment-duration');
    const monthlyPaymentDisplay = document.getElementById('monthly-payment');

    if (!downPaymentInput || !durationInput || !monthlyPaymentDisplay) return;

    // If totalAmount is not provided (e.g. from input event), fetch it
    let total = totalAmount;
    if (typeof total !== 'number') {
        total = parseFloat(document.getElementById('sale-total').textContent.replace('Rs. ', '').replace(/,/g, '')) || 0;
    }

    const downPayment = parseFloat(downPaymentInput.value) || 0;
    let duration = parseInt(durationInput.value);

    // Validate duration
    if (!duration || duration < 1) {
        duration = 1;
        durationInput.value = 1; // Auto-correct invalid duration
    }

    let remaining = total - downPayment;
    if (remaining < 0) remaining = 0;

    const monthly = remaining / duration;

    monthlyPaymentDisplay.textContent = `Rs. ${formatCurrency(monthly)}`;
}

// Handle customer selection change to show/hide walk-in name
document.getElementById('sale-customer').addEventListener('change', (e) => {
    const walkinGroup = document.getElementById('walkin-name-group');
    if (e.target.value === "0") {
        walkinGroup.classList.remove('hidden');
        document.getElementById('walkin-name').required = true;
    } else {
        walkinGroup.classList.add('hidden');
        document.getElementById('walkin-name').required = false;
        document.getElementById('walkin-name').value = '';
    }
});

// Sale form submit
document.getElementById('sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Prevent submission if there are unsaved edits/selections in the Add Product section
    const currentProductInput = document.getElementById('current-sale-product');
    if (currentProductInput && currentProductInput.value) {
        showNotification('error', 'Unsaved product in "Add Product" — save it to cart or clear before completing sale.');

        // Visually scroll them to where the problem is
        document.getElementById('sale-item-input-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const customerIdVal = document.getElementById('sale-customer').value;
    const customerId = !customerIdVal || customerIdVal === "0" ? null : parseInt(customerIdVal);
    const walkinName = customerId === null ? document.getElementById('walkin-name').value : null;

    if (!customerIdVal && !walkinName) {
        showNotification('error', 'Please select a Customer or Walk-in.');
        return;
    }
    const paymentType = document.getElementById('payment-type').value;

    // Installments are not allowed for walk-in customers
    if (customerId === null && paymentType === 'Installment') {
        showNotification('error', 'Installments are not allowed for walk-in customers. Please select or register a customer.');
        return;
    }

    // Collect sale items and validate stock
    const items = [...saleCart];

    if (items.length === 0) {
        showNotification('error', 'Please add at least one product to the cart');
        return;
    }

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);

    const saleData = {
        customer_id: customerId,
        walkin_name: walkinName,
        items,
        payment_type: paymentType,
        total_amount: totalAmount
    };

    // Add installment data if applicable
    if (paymentType === 'Installment') {
        const downPayment = parseFloat(document.getElementById('down-payment').value) || 0;
        const duration = parseInt(document.getElementById('installment-duration').value);

        if (!duration || duration < 1) {
            showNotification('error', 'Please enter valid installment duration');
            return;
        }

        if (downPayment < 0) {
            showNotification('error', 'Down payment cannot be negative');
            return;
        }

        const total = totalAmount;

        if (downPayment > total) {
            showNotification('error', 'Down payment cannot be greater than total amount');
            return;
        }

        const remaining = total - downPayment;
        const monthly = remaining / duration;

        // Use the user-selected first installment due date
        const nextDueDateValue = document.getElementById('installment-start-date').value;
        if (!nextDueDateValue) {
            showNotification('error', 'Please select the first installment due date');
            return;
        }

        saleData.installment_data = {
            down_payment: downPayment,
            installment_duration: duration,
            monthly_amount: monthly,
            next_due_date: nextDueDateValue,
            guarantor_name: document.getElementById('guarantor-name').value.trim(),
            guarantor_cnic: document.getElementById('guarantor-cnic').value.trim(),
            guarantor_mobile: document.getElementById('guarantor-mobile').value.trim(),
            guarantor_address: document.getElementById('guarantor-address').value.trim()
        };
    }

    try {
        const result = await window.api.createSale(saleData);
        if (result.success) {
            showNotification('success', result.message);
            document.getElementById('sale-form').reset();
            document.getElementById('walkin-name-group').classList.add('hidden');
            saleCart = [];
            cartItemCounter = 0;
            renderSaleCart();
            document.getElementById('current-sale-product').value = '';
            document.getElementById('current-sale-quantity').value = '1';
            document.getElementById('current-sale-subtotal').value = 'Rs. 0.00';
            document.getElementById('current-sale-subtotal').dataset.custom = 'false';
            document.getElementById('sale-total').textContent = 'Rs. 0.00';
            document.getElementById('installment-details').classList.add('hidden');
            document.getElementById('installment-start-date').value = '';
            document.getElementById('guarantor-name').value = '';
            document.getElementById('guarantor-cnic').value = '';
            document.getElementById('guarantor-mobile').value = '';
            document.getElementById('guarantor-address').value = '';

            // Reload data
            loadSalesTab();
            loadProducts();
            loadDashboard();

            // Show invoice
            viewInvoice(result.sale_id);
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error creating sale: ' + error.message);
    }
});

document.getElementById('clear-sale-btn').addEventListener('click', () => {
    document.getElementById('sale-form').reset();
    document.getElementById('walkin-name-group').classList.add('hidden');
    saleCart = [];
    cartItemCounter = 0;
    renderSaleCart();
    document.getElementById('current-sale-product').value = '';
    document.getElementById('current-sale-quantity').value = '1';
    document.getElementById('current-sale-subtotal').value = 'Rs. 0.00';
    document.getElementById('current-sale-subtotal').dataset.custom = 'false';
    document.getElementById('sale-total').textContent = 'Rs. 0.00';
    document.getElementById('installment-details').classList.add('hidden');
    document.getElementById('guarantor-name').value = '';
    document.getElementById('guarantor-cnic').value = '';
    document.getElementById('guarantor-mobile').value = '';
    document.getElementById('guarantor-address').value = '';
});

// --- Invoice Language Support ---
let currentInvoiceLanguage = 'en';
let currentViewingSaleId = null;

const INVOICE_LANG = {
    en: {
        title: "INVOICE",
        customerDetails: "Customer Details",
        name: "Name",
        phone: "Phone",
        address: "Address",
        walkin: "Walk-in Customer",
        na: "N/A",
        invoiceDetails: "Invoice Details",
        invoiceNum: "Invoice #",
        date: "Date",
        paymentType: "Payment Type",
        installmentPlan: "Installment Plan Details",
        downPayment: "Down Payment",
        remainingBalance: "Remaining Balance",
        duration: "Duration",
        months: "Months",
        monthlyInstallment: "Monthly Installment",
        nextDueDate: "Next Due Date",
        guarantor: "Guarantor Details",
        guarName: "Name",
        guarCnic: "CNIC / ID",
        guarMobile: "Mobile",
        guarAddress: "Address",
        itemsPurchased: "Items Purchased",
        product: "Product",
        qty: "Qty",
        returnedSuffix: "Returned",
        unitPrice: "Unit Price",
        installmentPrice: "Installment Price",
        subtotal: "Subtotal",
        totalAmount: "TOTAL AMOUNT:",
        returnSummary: "Return Summary",
        returnedProduct: "Returned Product",
        retQty: "Ret Qty",
        unitRefund: "Unit Refund",
        totalRefundAmount: "Total Refund",
        totalRefunded: "TOTAL REFUNDED:",
        currency: "Rs.",
        paymentMethod: "Payment Method",
        noteTitle: "نوٹ:",
        note1: "بجلی کی تاروں میں خرابی، بجلی کی کمی یا زیادتی غلط اور بلاضرورت مشین کو استعمال کرنے سے پرہیز کریں۔",
        note2: "برف کے خانے میں برتن اکھاڑتے ہوئے چھری یا کسی لوہے کی چیز کا استعمال نہ کریں۔",
        note3: "نیز فرم ہذا پر کسی قسم کے نقصان کی ذمہ داری نہیں ہوگی ، اگر مشین لوڈنگ یا لانے لے جانے کے دوران خراب ہو جائے۔",
        note4: "مشین کی خرابی کی صورت میں ہمارے مکینک معائنہ کریں گے ، معائنہ فیس وصول کی جائے گی نیز مرمت ورکشاپ میں کی جائے گی۔",
        note5: "کمپنی کے جاری کردہ گارنٹی کارڈ کے مطابق گارنٹی پوری (Cover) کی جائے گی۔ مشین میں نقص کی صورت میں گارنٹی کارڈ ہمراہ لانا لازمی ہوگا۔",
        note6: "مکینک سے براہ راست مرمت کرانے کی صورت میں فرم ہذا پر کسی قسم کی ذمہ داری عائد نہ ہوگی، فروخت شدہ مال نہ واپس ہوگا اور نہ تبدیل۔",
        note7: "وارنٹی میں موٹر کمپریسر ایک بار تبدیل ہوگا۔"
    },
    ur: {
        title: "انوائس",
        customerDetails: "گاہک کی تفصیلات",
        name: "نام",
        phone: "فون نمبر",
        address: "پتہ",
        walkin: "عام گاہک",
        na: "درج نہیں",
        invoiceDetails: "انوائس کی تفصیلات",
        invoiceNum: "انوائس نمبر",
        date: "تاریخ",
        paymentType: "ادائیگی کی قسم",
        installmentPlan: "قسط کی تفصیلات",
        downPayment: "ایڈوانس ادائیگی (Down Payment)",
        remainingBalance: "بقیہ رقم",
        duration: "مدت",
        months: "مہینے",
        monthlyInstallment: "ماہانہ قسط",
        nextDueDate: "اگلی تاریخِ ادائیگی",
        guarantor: "ضامن کی تفصیلات",
        guarName: "نام",
        guarCnic: "شناختی کارڈ نمبر",
        guarMobile: "موبائل نمبر",
        guarAddress: "پتہ",
        itemsPurchased: "خریدی گئی اشیاء",
        product: "پروڈکٹ",
        qty: "مقدار",
        returnedSuffix: "واپس شدہ",
        unitPrice: "قیمت",
        installmentPrice: "قسط کی قیمت",
        subtotal: "کل قیمت",
        totalAmount: "کل رقم:",
        returnSummary: "واپسی کی تفصیل",
        returnedProduct: "واپس شدہ پروڈکٹ",
        retQty: "مقداری واپسی",
        unitRefund: "فی یونٹ واپسی رقم",
        totalRefundAmount: "کل واپسی رقم",
        totalRefunded: "کل ادا شدہ رقم:",
        currency: "روپے",
        paymentMethod: "ادائیگی کا طریقہ",
        noteTitle: "نوٹ:",
        note1: "بجلی کی تاروں میں خرابی، بجلی کی کمی یا زیادتی غلط اور بلاضرورت مشین کو استعمال کرنے سے پرہیز کریں۔",
        note2: "برف کے خانے میں برتن اکھاڑتے ہوئے چھری یا کسی لوہے کی چیز کا استعمال نہ کریں۔",
        note3: "نیز فرم ہذا پر کسی قسم کے نقصان کی ذمہ داری نہیں ہوگی ، اگر مشین لوڈنگ یا لانے لے جانے کے دوران خراب ہو جائے۔",
        note4: "مشین کی خرابی کی صورت میں ہمارے مکینک معائنہ کریں گے ، معائنہ فیس وصول کی جائے گی نیز مرمت ورکشاپ میں کی جائے گی۔",
        note5: "کمپنی کے جاری کردہ گارنٹی کارڈ کے مطابق گارنٹی پوری (Cover) کی جائے گی۔ مشین میں نقص کی صورت میں گارنٹی کارڈ ہمراہ لانا لازمی ہوگا۔",
        note6: "مکینک سے براہ راست مرمت کرانے کی صورت میں فرم ہذا پر کسی قسم کی ذمہ داری عائد نہ ہوگی، فروخت شدہ مال نہ واپس ہوگا اور نہ تبدیل۔",
        note7: "وارنٹی میں موٹر کمپریسر ایک بار تبدیل ہوگا۔"
    }
};

window.toggleInvoiceLanguage = function (lang) {
    currentInvoiceLanguage = lang;
    if (currentViewingSaleId !== null) {
        viewInvoice(currentViewingSaleId);
    }
};

// --- Action Dropdown Support ---
window.toggleActionDropdown = function (event, element) {
    event.stopPropagation();
    const list = element.nextElementSibling;
    const isActive = list.classList.contains('active');

    // Close all other open dropdowns first
    document.querySelectorAll('.action-dropdown-list.active').forEach(dropdown => {
        dropdown.classList.remove('active');
    });

    if (!isActive) {
        list.classList.add('active');
    }
};

window.addEventListener('click', () => {
    document.querySelectorAll('.action-dropdown-list.active').forEach(dropdown => {
        dropdown.classList.remove('active');
    });
});
// --------------------------------

async function viewInvoice(saleId, currentBalance = null) {
    try {
        const result = await window.api.getSaleDetails(saleId);
        if (result.success) {
            const sale = result.sale;

            // Calculate remaining balance for installment sales
            let remainingBalance = 0;
            if (sale.payment_type === 'Installment') {
                if (currentBalance !== null) {
                    remainingBalance = currentBalance;
                } else {
                    remainingBalance = sale.remaining_balance !== undefined
                        ? sale.remaining_balance
                        : (sale.total_amount - (sale.down_payment || 0));
                }
            }

            currentViewingSaleId = saleId;
            const t = INVOICE_LANG[currentInvoiceLanguage];
            const isUrdu = currentInvoiceLanguage === 'ur';
            const dir = isUrdu ? 'rtl' : 'ltr';
            const textAlign = isUrdu ? 'right' : 'left';
            const fontStyle = isUrdu ? "font-family: 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif; line-height: 1.6;" : "";

            let invoiceHTML = `
                <div class="printable-invoice" style="direction: ${dir}; ${fontStyle}">
                    ${getShopHeaderHTML()}
                    <h2 class="invoice-title">${t.title}</h2>
                    
                    <div class="invoice-details-grid">
                        <div class="invoice-box">
                            <h3>${t.customerDetails}</h3>
                            <p><strong>${t.name}:</strong> ${sale.customer_name || t.walkin}</p>
                            <p><strong>${t.phone}:</strong> ${sale.phone || t.na}</p>
                            <p><strong>${t.address}:</strong> ${sale.address || t.na}</p>
                        </div>
                        <div class="invoice-box">
                            <h3>${t.invoiceDetails}</h3>
                            <p><strong>${t.invoiceNum}:</strong> ${sale.sale_id}</p>
                            <p><strong>${t.date}:</strong> ${formatDate(sale.sale_date)}</p>
                            <p><strong>${t.paymentType}:</strong> ${sale.payment_type}</p>
                        </div>
                    </div>
                    
                    ${(sale.payment_type === 'Installment' && sale.payments && sale.payments.length > 0) ? `
                    <div class="invoice-plan-details" style="margin-top: 1rem; border-top: 2px dashed var(--danger-light); padding-top: 1rem;">
                        <h3 style="margin-bottom: 0.5rem; text-align: ${textAlign}; color: var(--primary); font-size: 1.1rem; border: none; background: transparent;">${isUrdu ? 'قسطوں کی ادائیگی کی تاریخ' : 'Payment History'}</h3>
                        <table class="invoice-table items-table">
                            <thead>
                                <tr>
                                    <th style="text-align: ${textAlign};">${isUrdu ? 'تاریخ' : 'Date'}</th>
                                    <th style="text-align: center;">${t.paymentMethod}</th>
                                    <th style="text-align: ${isUrdu ? 'left' : 'right'};">${isUrdu ? 'رقم ادا کی' : 'Amount Paid'}</th>
                                    <th style="text-align: ${isUrdu ? 'left' : 'right'};">${isUrdu ? 'بقیہ رقم' : 'Remaining Balance'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sale.payments.map(payment => `
                                    <tr>
                                        <td style="text-align: ${textAlign};">${formatDate(payment.payment_date)}</td>
                                        <td style="text-align: center;">${payment.payment_method || (isUrdu ? 'نقد' : 'Cash')}</td>
                                        <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(payment.amount_paid)}</td>
                                        <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(payment.remaining_balance_after)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ` : ''}

                    ${sale.payment_type === 'Installment' ? `
                        <div class="invoice-plan-details" style="margin-top: 1rem;">
                            <h3>${t.installmentPlan}</h3>
                            <table class="invoice-table">
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.downPayment}</th>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(sale.down_payment)}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.remainingBalance}</th>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(remainingBalance)}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.duration}</th>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'};">${sale.installment_duration} ${t.months}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.monthlyInstallment}</th>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(sale.monthly_amount)}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.nextDueDate}</th>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'};">${formatDate(sale.next_due_date)}</td>
                                </tr>
                            </table>
                        </div>
                        ${(sale.guarantor_name || sale.guarantor_cnic || sale.guarantor_mobile || sale.guarantor_address) ? `
                        <div class="invoice-plan-details" style="margin-top: 1rem;">
                            <h3><i class="fas fa-user-shield" style="margin-right:0.4rem;"></i>${t.guarantor}</h3>
                            <table class="invoice-table">
                                ${sale.guarantor_name ? `<tr><th style="text-align:${textAlign};">${t.guarName}</th><td style="text-align:${isUrdu ? 'left' : 'right'};">${sale.guarantor_name}</td></tr>` : ''}
                                ${sale.guarantor_cnic ? `<tr><th style="text-align:${textAlign};">${t.guarCnic}</th><td style="text-align:${isUrdu ? 'left' : 'right'};">${sale.guarantor_cnic}</td></tr>` : ''}
                                ${sale.guarantor_mobile ? `<tr><th style="text-align:${textAlign};">${t.guarMobile}</th><td style="text-align:${isUrdu ? 'left' : 'right'};">${sale.guarantor_mobile}</td></tr>` : ''}
                                ${sale.guarantor_address ? `<tr><th style="text-align:${textAlign};">${t.guarAddress}</th><td style="text-align:${isUrdu ? 'left' : 'right'};">${sale.guarantor_address}</td></tr>` : ''}
                            </table>
                        </div>
                        ` : ''}
                    ` : ''}

                    <div class="invoice-items">
                        <h3>${t.itemsPurchased}</h3>
                        <table class="invoice-table">
                            <thead>
                                <tr>
                                    <th style="text-align: ${textAlign};">${t.product}</th>
                                    <th style="text-align: center;">${t.qty}</th>
                                    <th style="text-align: ${isUrdu ? 'left' : 'right'};">${sale.payment_type === 'Installment' ? t.installmentPrice : t.subtotal}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sale.items.map((item) => `
                                    <tr>
                                        <td style="text-align: ${textAlign};">
                                            ${item.product_name}
                                            ${item.returned_qty > 0 ? `<br><small class="text-danger">(${t.returnedSuffix}: ${item.returned_qty})</small>` : ''}
                                        </td>
                                        <td style="text-align: center;">${item.quantity}</td>
                                        <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(item.subtotal)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="2" style="text-align: ${isUrdu ? 'left' : 'right'}; font-weight: bold;">${t.totalAmount}</td>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'}; font-weight: bold;">${t.currency} ${formatCurrency(sale.total_amount)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    ${sale.items.some(i => i.returned_qty > 0) ? `
                    <div class="invoice-items" style="margin-top: 2rem; border-top: 2px dashed var(--danger-light); padding-top: 1rem;">
                        <h3 style="color: var(--danger);"><i class="fas fa-undo"></i> ${t.returnSummary}</h3>
                        <table class="invoice-table items-table">
                            <thead>
                                <tr style="background: var(--danger-light);">
                                    <th style="text-align: ${textAlign};">${t.returnedProduct}</th>
                                    <th style="text-align: center;">${t.retQty}</th>
                                    <th style="text-align: ${isUrdu ? 'left' : 'right'};">${t.totalRefundAmount}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sale.items.filter(i => i.returned_qty > 0).map(item => `
                                    <tr>
                                        <td style="text-align: ${textAlign}; color: var(--danger); font-weight: 600;">${item.product_name}</td>
                                        <td style="text-align: center;">${item.returned_qty}</td>
                                        <td style="text-align: ${isUrdu ? 'left' : 'right'};">${t.currency} ${formatCurrency(item.returned_qty * (item.subtotal / item.quantity))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot style="border-top: 1px solid var(--danger);">
                                <tr>
                                    <td colspan="2" style="text-align: ${isUrdu ? 'left' : 'right'}; font-weight: bold; color: var(--danger);">${t.totalRefunded}</td>
                                    <td style="text-align: ${isUrdu ? 'left' : 'right'}; font-weight: bold; color: var(--danger);">${t.currency} ${formatCurrency(sale.items.reduce((sum, i) => sum + ((i.returned_qty || 0) * (i.subtotal / i.quantity)), 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    ` : ''}

                    <!-- <div class="invoice-footer" style="margin-top: 2rem; font-size: 0.85rem; text-align: justify; direction: rtl; font-family: 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif; line-height: 1.5;">
                        <div style="font-size: 1.2rem; font-weight: bold; margin-bottom: 0.5rem; text-align: right;">${t.noteTitle}</div>
                        <ol style="padding-right: 1rem; margin-bottom: 0; text-align: right;">
                            <li>${t.note1}</li>
                            <li>${t.note2}</li>
                            <li>${t.note3}</li>
                            <li>${t.note4}</li>
                            <li>${t.note5}</li>
                            <li>${t.note6}</li>
                            <li>${t.note7}</li>
                        </ol>
                    </div> -->
                </div>
            `;

            document.getElementById('invoice-content').innerHTML = invoiceHTML;
            openModal('invoice-modal');
        }
    } catch (error) {
        showNotification('error', 'Error loading invoice: ' + error.message);
    }
}

async function downloadInvoicePDF() {
    if (!currentViewingSaleId) return;

    // Briefly hide UI elements we don't want in the PDF (like close and print buttons)
    // The printToPDF command actually captures the DOM exactly as it is right now.
    // The CSS @media print block handles most of this implicitly, but ensuring the modal footer is gone helps clean it up perfectly.
    const modalFooter = document.querySelector('#invoice-modal .modal-footer');
    if (modalFooter) modalFooter.style.display = 'none';

    // Small delay to let DOM render the display:none
    setTimeout(async () => {
        try {
            const result = await window.api.downloadInvoice(currentViewingSaleId);
            if (result.success) {
                showNotification('success', result.message);
            } else if (result.message !== 'Download cancelled') {
                showNotification('error', result.message);
            }
        } catch (error) {
            showNotification('error', 'Failed to generate PDF: ' + error.message);
        } finally {
            // Restore buttons
            if (modalFooter) modalFooter.style.display = 'flex';
        }
    }, 50);
}


async function openReturnModal(saleId) {
    try {
        const result = await window.api.getSaleDetails(saleId);
        if (!result.success) {
            showNotification('error', result.message);
            return;
        }

        const sale = result.sale;
        document.getElementById('return-sale-id').value = saleId;
        document.getElementById('return-sale-customer').textContent = sale.customer_name || 'Walk-in Customer';
        document.getElementById('return-sale-date').textContent = formatDate(sale.sale_date);
        document.getElementById('return-sale-total').textContent = `Rs. ${formatCurrency(sale.total_amount)}`;

        // New fields
        document.getElementById('return-sale-payment-type').value = sale.payment_type;
        document.getElementById('return-sale-remaining-balance').value = sale.remaining_balance || 0;

        const methodBadge = document.getElementById('return-sale-method');
        methodBadge.textContent = sale.payment_type;
        methodBadge.className = sale.payment_type === 'Installment' ? 'badge badge-warning' : 'badge badge-success';

        document.getElementById('return-refund-calc').style.display = 'none';

        const returnItemsContainer = document.getElementById('return-items-container');
        returnItemsContainer.innerHTML = '';

        sale.items.forEach(item => {
            const originalQty = item.quantity;
            const alreadyReturned = item.returned_qty || 0;
            const returnableQty = originalQty - alreadyReturned;

            if (returnableQty > 0) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'form-group row align-items-center mb-3';
                itemDiv.innerHTML = `
                    <div class="col-sm-6">
                        <label class="font-weight-bold mb-0">${item.product_name}</label>
                        <div class="small text-muted">
                            Total Purchased: ${originalQty} | Remaining: ${returnableQty}
                        </div>
                    </div>
                    <div class="col-sm-6">
                        <div class="input-group">
                            <div class="input-group-prepend">
                                <span class="input-group-text badge-danger text-white">Return Qty</span>
                            </div>
                            <input type="number" class="form-control return-item-qty"
                                   data-sale-item-id="${item.sale_item_id}"
                                   data-max-qty="${returnableQty}"
                                   data-unit-price="${item.subtotal / item.quantity}"
                                   value="0" min="0" max="${returnableQty}">
                        </div>
                    </div>
                `;
                returnItemsContainer.appendChild(itemDiv);
            }
        });

        if (returnItemsContainer.children.length === 0) {
            returnItemsContainer.innerHTML = '<p class="text-muted">No items available for return.</p>';
            document.getElementById('process-return-btn').disabled = true;
        } else {
            document.getElementById('process-return-btn').disabled = false;
        }

        document.querySelectorAll('.return-item-qty').forEach(input => {
            input.addEventListener('input', calculateReturnRefund);
        });

        openModal('return-modal');
    } catch (error) {
        showNotification('error', 'Error opening return modal: ' + error.message);
    }
}

function calculateReturnRefund() {
    let totalRefund = 0;

    document.querySelectorAll('.return-item-qty').forEach(input => {
        const returnQty = parseInt(input.value) || 0;
        const unitPrice = parseFloat(input.dataset.unitPrice) || 0;
        totalRefund += (returnQty * unitPrice);
    });

    const calcDiv = document.getElementById('return-refund-calc');
    const totalSpan = document.getElementById('return-calc-total');
    const deductRow = document.getElementById('return-calc-deduction-row');
    const deductSpan = document.getElementById('return-calc-deduction');
    const cashSpan = document.getElementById('return-calc-cash');

    if (totalRefund === 0) {
        calcDiv.style.display = 'none';
        return;
    }

    calcDiv.style.display = 'block';
    totalSpan.textContent = `Rs. ${formatCurrency(totalRefund)}`;

    const paymentType = document.getElementById('return-sale-payment-type').value;

    if (paymentType === 'Installment') {
        const remainingBalance = parseFloat(document.getElementById('return-sale-remaining-balance').value) || 0;
        const newRemaining = Math.max(0, remainingBalance - totalRefund);
        const deducted = remainingBalance - newRemaining;
        const cashRefund = Math.max(0, totalRefund - deducted);

        deductRow.style.display = 'block';
        deductSpan.textContent = `Rs. ${formatCurrency(deducted)}`;
        cashSpan.textContent = `Rs. ${formatCurrency(cashRefund)}`;
    } else {
        deductRow.style.display = 'none';
        cashSpan.textContent = `Rs. ${formatCurrency(totalRefund)}`;
    }
}

document.getElementById('process-return-btn').addEventListener('click', async () => {
    const isConfirmed = await appConfirm('Are you sure you want to process this return?');
    if (!isConfirmed) {
        return;
    }
    const saleId = document.getElementById('return-sale-id').value;
    const returnItems = [];
    let hasReturn = false;

    document.querySelectorAll('.return-item-qty').forEach(input => {
        const saleItemId = parseInt(input.dataset.saleItemId);
        const returnQty = parseInt(input.value);
        const maxQty = parseInt(input.dataset.maxQty);

        if (returnQty > 0) {
            if (returnQty > maxQty) {
                showNotification('error', `Return quantity for an item exceeds available quantity.`);
                hasReturn = false; // Reset to false if validation fails
                return;
            }
            returnItems.push({ saleItemId, returnQty });
            hasReturn = true;
        }
    });

    if (!hasReturn) {
        showNotification('error', 'Please enter a quantity for at least one item to return.');
        return;
    }

    try {
        const result = await window.api.processSaleReturn({ saleId: parseInt(saleId), items: returnItems });
        if (result.success) {
            showNotification('success', result.message);
            closeModal('return-modal');
            loadSalesTab();
            loadProducts();

            // Preserve active installment filter
            const activeInstallmentFilter = document.querySelector('.installment-filter.active');
            const currentStatus = activeInstallmentFilter ? activeInstallmentFilter.dataset.status : null;
            if (currentStatus) {
                loadInstallments({ status: currentStatus });
            } else {
                loadInstallments();
            }

            loadDashboard();

            // Auto-refresh active report if visible
            const reportOutput = document.getElementById('report-output');
            if (reportOutput && !reportOutput.classList.contains('hidden') && lastReportContext.type) {
                switch (lastReportContext.type) {
                    case 'daily': generateDailyReport(...lastReportContext.args); break;
                    case 'monthly': generateMonthlyReport(...lastReportContext.args); break;
                    case 'installment': generateInstallmentReport(); break;
                    case 'overdue': generateOverdueReport(); break;
                    case 'daterange': generateDateRangeReport(...lastReportContext.args); break;
                }
            }
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error processing return: ' + error.message);
    }
});


// ═══════════════════════════════════════════════════════════
// INSTALLMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function loadInstallments(filters = {}) {
    try {
        const result = await window.api.getAllInstallments(filters);
        if (result.success) {
            allInstallments = result.installments;
            currentInstallmentsPage = 1;
            renderInstallmentsTable(allInstallments);
        }
    } catch (error) {
        console.error('Error loading installments:', error);
    }
}

function renderInstallmentsTable(installments, page = null) {
    const tbody = document.getElementById('installments-tbody');
    const paginationDiv = document.getElementById('installments-pagination');

    if (installments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No installments found</td></tr>';
        if (paginationDiv) paginationDiv.classList.add('hidden');
        return;
    }

    // Group installments by customer name
    const groups = {};
    const groupOrder = [];
    installments.forEach(inst => {
        const key = inst.customer_name || 'N/A';
        if (!groups[key]) {
            groups[key] = {
                installments: [],
                cnic: inst.id_number || 'N/A'
            };
            groupOrder.push(key);
        }
        groups[key].installments.push(inst);
    });

    // Pagination by Groups (Users)
    const totalGroups = groupOrder.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / installmentsPageSize));
    if (page !== null) currentInstallmentsPage = page;
    if (currentInstallmentsPage > totalPages) currentInstallmentsPage = totalPages;
    
    const startIdx = (currentInstallmentsPage - 1) * installmentsPageSize;
    const pagedGroups = groupOrder.slice(startIdx, startIdx + installmentsPageSize);

    // Build the rows for the paged groups
    const pageRows = [];
    pagedGroups.forEach(name => {
        const group = groups[name];
        pageRows.push({ type: 'group', name, count: group.installments.length, cnic: group.cnic });
        group.installments.forEach(inst => pageRows.push({ type: 'row', inst }));
    });

    tbody.innerHTML = pageRows.map(rowData => {
        if (rowData.type === 'group') {
            return `
            <tr style="background: var(--dark-surface, #1e293b); border-top: 2px solid var(--accent-color, #3b82f6);">
                <td colspan="9" style="padding: 6px 12px; font-weight: 700; color: var(--accent-color, #3b82f6); font-size: 0.88rem; letter-spacing: 0.03em;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div>
                            <i class="fas fa-user" style="margin-right: 6px; opacity: 0.8;"></i>${rowData.name}
                            <span style="margin-left: 8px; font-weight: 400; font-size: 0.8rem; opacity: 0.7;">(${rowData.count} record${rowData.count !== 1 ? 's' : ''})</span>
                        </div>
                        <div style="font-size: 0.8rem; opacity: 0.9; color: #94a3b8; font-weight: normal;">
                            <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${rowData.cnic}
                        </div>
                    </div>
                </td>
            </tr>`;
        }

        const inst = rowData.inst;
        const badgeClass = inst.status === 'Active' ? 'badge-success' :
            inst.status === 'Overdue' ? 'badge-danger' : 'badge-secondary';

        const paidAmount = inst.total_amount - inst.remaining_balance;

        return `
            <tr>
                <td style="text-align: center;"><strong>#${inst.sale_id}</strong> ${inst.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${inst.sale_id})" style="font-size: 0.6rem; padding: 2px 4px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}</td>
                <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${inst.product_names || 'N/A'}">${inst.product_names || 'N/A'}</td>
                <td style="text-align: right;">${formatCurrency(inst.total_amount)}</td>
                <td style="text-align: right; color: #27ae60; font-weight: 600;">${formatCurrency(paidAmount)}</td>
                <td style="text-align: right;" class="text-danger font-weight-bold">${formatCurrency(inst.remaining_balance)}</td>
                <td style="text-align: right;">${formatCurrency(inst.monthly_amount)}</td>
                <td style="text-align: center;">${formatDate(inst.next_due_date)}</td>
                <td style="text-align: center;"><span class="badge ${badgeClass}">${inst.status}</span></td>
                <td class="table-actions">
                    <button class="action-btn-compact btn-info" onclick="viewInvoice(${inst.sale_id})" title="View Invoice">
                        <i class="fas fa-file-invoice"></i>
                    </button>
                    <button class="action-btn-compact btn-success" onclick="recordPayment(${inst.installment_id})" title="Record Payment">
                        <i class="fas fa-money-bill-wave"></i>
                    </button>
                    <div class="action-dropdown">
                        <div class="action-dropdown-btn" onclick="toggleActionDropdown(event, this)">
                            <i class="fas fa-ellipsis-v"></i>
                        </div>
                        <div class="action-dropdown-list">
                            <div class="action-dropdown-item" onclick="viewPaymentHistory(${inst.installment_id})">
                                <i class="fas fa-history"></i> History
                            </div>
                            <div class="action-dropdown-item" onclick="openReturnModal(${inst.sale_id})">
                                <i class="fas fa-undo"></i> Return
                            </div>
                            <div class="action-dropdown-item" onclick="editInstallment(${inst.installment_id})">
                                <i class="fas fa-edit"></i> Edit
                            </div>
                            <div class="action-dropdown-divider" style="height: 1px; background: var(--dark-border); margin: 4px 0;"></div>
                            <div class="action-dropdown-item text-danger" onclick="deleteInstallment(${inst.installment_id})">
                                <i class="fas fa-trash"></i> Delete
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Render pagination controls
    if (paginationDiv) {
        if (totalPages <= 1) {
            paginationDiv.classList.add('hidden');
        } else {
            paginationDiv.classList.remove('hidden');
            paginationDiv.innerHTML = `
                <button class="btn btn-secondary btn-sm" id="inst-prev-page" ${currentInstallmentsPage <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
                <span class="report-page-info">Page ${currentInstallmentsPage} of ${totalPages}</span>
                <button class="btn btn-secondary btn-sm" id="inst-next-page" ${currentInstallmentsPage >= totalPages ? 'disabled' : ''}>
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            `;
            document.getElementById('inst-prev-page').addEventListener('click', () => {
                if (currentInstallmentsPage > 1) {
                    renderInstallmentsTable(installments, currentInstallmentsPage - 1);
                }
            });
            document.getElementById('inst-next-page').addEventListener('click', () => {
                if (currentInstallmentsPage < totalPages) {
                    renderInstallmentsTable(installments, currentInstallmentsPage + 1);
                }
            });
        }
    }
}

// Installment search
document.getElementById('installment-search').addEventListener('input', debounce((e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = allInstallments.filter(inst =>
        (inst.customer_name && inst.customer_name.toLowerCase().includes(term)) ||
        (inst.id_number && inst.id_number.toLowerCase().includes(term)) ||
        inst.sale_id.toString().includes(term)
    );
    currentInstallmentsPage = 1;
    renderInstallmentsTable(filtered);
}, 300));

// Installment filters
document.querySelectorAll('.installment-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.installment-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const status = btn.dataset.status;
        currentInstallmentsPage = 1;
        if (status) {
            loadInstallments({ status });
        } else {
            loadInstallments();
        }
    });
});

async function recordPayment(installmentId) {
    const installment = allInstallments.find(i => i.installment_id === installmentId);
    if (!installment) return;

    document.getElementById('payment-installment-id').value = installmentId;
    document.getElementById('payment-amount').value = installment.monthly_amount;

    // Set default next due date to today + 30 days
    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 30);
    document.getElementById('payment-next-due').value = nextDueDate.toISOString().split('T')[0];

    const infoHTML = `
        <div class="card" style="margin-bottom: 1rem; background: rgba(59, 130, 246, 0.1);">
            <p><strong>Customer:</strong> ${installment.customer_name}</p>
            <p><strong>Remaining Balance:</strong> Rs. ${formatCurrency(installment.remaining_balance)}</p>
            <p><strong>Monthly Amount:</strong> Rs. ${formatCurrency(installment.monthly_amount)}</p>
        </div>
    `;

    document.getElementById('payment-installment-info').innerHTML = infoHTML;

    // Load payment history (for viewing purposes in modal, using valid existing function)
    await viewPaymentHistory(installmentId, false);

    openModal('payment-modal');
}

async function printInstallmentHistory(installmentId) {
    try {
        const installment = allInstallments.find(i => i.installment_id === installmentId);
        if (!installment) return;

        // Fetch comprehensive data
        const [saleResult, paymentsResult] = await Promise.all([
            window.api.getSaleDetails(installment.sale_id),
            window.api.getPaymentHistory(installmentId)
        ]);

        if (saleResult.success && paymentsResult.success) {
            const sale = saleResult.sale;
            const payments = paymentsResult.payments;

            // Generate HTML for the printable statement
            let statementHTML = `
                <div class="printable-invoice">
                    ${getShopHeaderHTML()}
                    <div class="invoice-header-center">
                        <h2 class="invoice-title">INSTALLMENT STATEMENT</h2>
                        <p>Statement generated on ${new Date().toLocaleDateString()}</p>
                    </div>

                    <div class="invoice-details-grid">
                        <div class="invoice-box">
                            <h3>Customer Info</h3>
                            <p><strong>Name:</strong> ${sale.customer_name || 'N/A'}</p>
                            <p><strong>Phone:</strong> ${sale.phone || 'N/A'}</p>
                            <p><strong>Address:</strong> ${sale.address || 'N/A'}</p>
                        </div>
                        <div class="invoice-box">
                            <h3>Plan Details</h3>
                            <p><strong>Invoice #:</strong> #${sale.sale_id}</p>
                            <p><strong>Sale Date:</strong> ${formatDate(sale.sale_date)}</p>
                            <p><strong>Total Plan Amount:</strong> Rs. ${formatCurrency(sale.total_amount)}</p>
                        </div>
                    </div>

                    <div class="invoice-plan-overview">
                        <div class="plan-overview-header">
                            <h3>Plan Overview</h3>
                            <span><strong>Status:</strong> ${installment.status}</span>
                        </div>
                        <div class="plan-overview-grid">
                            <div>
                                <small>Down Payment</small>
                                <strong>Rs. ${formatCurrency(sale.down_payment)}</strong>
                            </div>
                            <div>
                                <small>Monthly Installment</small>
                                <strong>Rs. ${formatCurrency(sale.monthly_amount)}</strong>
                            </div>
                             <div>
                                <small>Duration</small>
                                <strong>${sale.installment_duration} Months</strong>
                            </div>
                             <div>
                                <small>Next Due Date</small>
                                <strong>${formatDate(sale.next_due_date)}</strong>
                            </div>
                        </div>
                    </div>

                    <div class="invoice-payment-history">
                         <h3>Payment History</h3>
                         <table class="invoice-table">
                            <thead>
                                <tr>
                                    <th style="text-align: left;">Date</th>
                                    <th style="text-align: right;">Amount Paid</th>
                                    <th style="text-align: center;">Payment Method</th>
                                    <th style="text-align: right;">Balance After</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            if (payments.length === 0) {
                statementHTML += `
                    <tr>
                        <td colspan="4" style="text-align: center;">No payments recorded yet.</td>
                    </tr>
                `;
            } else {
                payments.forEach((payment) => {
                    statementHTML += `
                        <tr>
                            <td>${formatDate(payment.payment_date)}</td>
                            <td style="text-align: right;">Rs. ${formatCurrency(payment.amount_paid)}</td>
                            <td style="text-align: center;">${payment.payment_method || 'Cash'}</td>
                            <td style="text-align: right;">Rs. ${formatCurrency(payment.remaining_balance_after)}</td>
                        </tr>
                    `;
                });
            }

            statementHTML += `
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td style="text-align: right; font-weight: bold;">Current Remaining Balance:</td>
                                    <td colspan="3" style="text-align: right; font-weight: bold;">Rs. ${formatCurrency(installment.remaining_balance)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <!-- <div class="invoice-footer" style="direction: rtl; font-family: 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif; line-height: 1.5; margin-top: 2rem; font-size: 0.85rem; text-align: justify;">
                        <div style="font-size: 1.2rem; font-weight: bold; margin-bottom: 0.5rem;">نوٹ:</div>
                        <ol style="padding-right: 1rem; margin-bottom: 0;">
                            <li>بجلی کی تاروں میں خرابی، بجلی کی کمی یا زیادتی غلط اور بلاضرورت مشین کو استعمال کرنے سے پرہیز کریں۔</li>
                            <li>برف کے خانے میں برتن اکھاڑتے ہوئے چھری یا کسی لوہے کی چیز کا استعمال نہ کریں۔</li>
                            <li>نیز فرم ہذا پر کسی قسم کے نقصان کی ذمہ داری نہیں ہوگی ، اگر مشین لوڈنگ یا لانے لے جانے کے دوران خراب ہو جائے۔</li>
                            <li>مشین کی خرابی کی صورت میں ہمارے مکینک معائنہ کریں گے ، معائنہ فیس وصول کی جائے گی نیز مرمت ورکشاپ میں کی جائے گی۔</li>
                            <li>کمپنی کے جاری کردہ گارنٹی کارڈ کے مطابق گارنٹی پوری (Cover) کی جائے گی۔ مشین میں نقص کی صورت میں گارنٹی کارڈ ہمراہ لانا لازمی ہوگا۔</li>
                            <li>مکینک سے براہ راست مرمت کرانے کی صورت میں فرم ہذا پر کسی قسم کی ذمہ داری عائد نہ ہوگی، فروخت شدہ مال نہ واپس ہوگا اور نہ تبدیل۔</li>
                            <li>وارنٹی میں موٹر کمپریسر ایک بار تبدیل ہوگا۔</li>
                        </ol>
                    </div> -->
                </div>
            `;

            document.getElementById('invoice-content').innerHTML = statementHTML;
            openModal('invoice-modal');
        } else {
            showNotification('error', 'Failed to retrieve installment details for printing.');
        }

    } catch (error) {
        console.error('Error generating installment statement:', error);
        showNotification('error', 'Error generating statement: ' + error.message);
    }
}

async function viewPaymentHistory(installmentId, openModalFlag = true) {
    try {
        const result = await window.api.getPaymentHistory(installmentId);
        if (result.success) {
            const payments = result.payments;
            const historyContainer = document.getElementById('payment-history-container');

            historyContainer.innerHTML = ''; // Clear previous content

            let historyHTML = '';
            if (payments.length === 0) {
                historyHTML = '<p class="text-muted" style="text-align: center; padding: 1rem;">No payment history found</p>';
            } else {
                historyHTML = '<div class="table-container" style="max-height: 200px; overflow-y: auto;"><table><thead><tr><th>Date</th><th>Amount Paid</th><th>Payment Method</th><th>Balance After</th></tr></thead><tbody>';

                payments.forEach(payment => {
                    historyHTML += `
                        <tr>
                            <td>${formatDate(payment.payment_date)}</td>
                            <td>Rs. ${formatCurrency(payment.amount_paid)}</td>
                            <td>${payment.payment_method || 'Cash'}</td>
                            <td>Rs. ${formatCurrency(payment.remaining_balance_after)}</td>
                        </tr>
                    `;
                });

                historyHTML += '</tbody></table></div>';
            }

            historyContainer.innerHTML = historyHTML;

            if (openModalFlag) {
                // If opening standalone history (not via payment modal), we might want to show some context
                // But currently this is mostly used as a helper for payment modal
                const installment = allInstallments.find(i => i.installment_id === installmentId);
                if (installment) {
                    // For standalone viewing, we can reuse payment modal or just show alert.
                    // Since we now have printInstallmentHistory, we might not need standalone 'viewPaymentHistory' as a popup
                    // Reusing payment-modal for "readonly" history view if needed:
                    const infoHTML = `
                        <div class="card" style="margin-bottom: 1rem;">
                            <h3>${installment.customer_name || 'Customer'}</h3>
                            <p><strong>Total Amount:</strong> Rs. ${formatCurrency(installment.total_amount)}</p>
                            <p><strong>Remaining Balance:</strong> Rs. ${formatCurrency(installment.remaining_balance)}</p>
                        </div>
                    `;
                    document.getElementById('payment-installment-info').innerHTML = infoHTML;
                    document.getElementById('payment-form').style.display = 'none'; // Hide payment form
                    openModal('payment-modal');
                }
            } else {
                document.getElementById('payment-form').style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading payment history:', error);
        showNotification('error', 'Failed to load payment history');
    }
}

// Payment form submit
document.getElementById('payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const installmentId = parseInt(document.getElementById('payment-installment-id').value);
    const amountPaid = parseFloat(document.getElementById('payment-amount').value);
    const paymentMethod = document.getElementById('payment-method').value;
    const nextDueDate = document.getElementById('payment-next-due').value;

    if (amountPaid < 0) {
        showNotification('error', 'Payment amount cannot be negative');
        return;
    }

    // Find installment to check balance
    const installment = allInstallments.find(i => i.installment_id === installmentId);
    if (installment && amountPaid > installment.remaining_balance) {
        showNotification('error', 'Payment amount exceeds remaining balance (Rs. ' + formatCurrency(installment.remaining_balance) + ')');
        return;
    }

    try {
        const result = await window.api.recordInstallmentPayment({ 
            installment_id: installmentId, 
            amount_paid: amountPaid,
            payment_method: paymentMethod,
            next_due_date: nextDueDate
        });
        if (result.success) {
            showNotification('success', result.message);
            closeModal('payment-modal');
            loadInstallments();
            loadDashboard();

            // Show invoice (receipt)
            if (installment && installment.sale_id) {
                viewInvoice(installment.sale_id, result.new_balance);
            }
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error recording payment: ' + error.message);
    }
});

// Edit Installment
function editInstallment(installmentId) {
    const installment = allInstallments.find(i => i.installment_id === installmentId);
    if (!installment) return;

    document.getElementById('edit-installment-id').value = installment.installment_id;
    document.getElementById('edit-installment-customer').value = installment.customer_name;
    document.getElementById('edit-installment-total').value = installment.total_amount;
    document.getElementById('edit-installment-remaining').value = installment.remaining_balance;
    document.getElementById('edit-installment-monthly').value = installment.monthly_amount;
    document.getElementById('edit-installment-due-date').value = installment.next_due_date.split('T')[0];
    document.getElementById('edit-installment-status').value = installment.status;

    openModal('edit-installment-modal');
}

document.getElementById('edit-installment-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const installmentData = {
        installment_id: parseInt(document.getElementById('edit-installment-id').value),
        total_amount: parseFloat(document.getElementById('edit-installment-total').value),
        remaining_balance: parseFloat(document.getElementById('edit-installment-remaining').value),
        monthly_amount: parseFloat(document.getElementById('edit-installment-monthly').value),
        next_due_date: document.getElementById('edit-installment-due-date').value,
        status: document.getElementById('edit-installment-status').value
    };

    if (installmentData.total_amount < 0 || installmentData.remaining_balance < 0 || installmentData.monthly_amount < 0) {
        showNotification('error', 'Installment values cannot be negative');
        return;
    }

    if (installmentData.remaining_balance > installmentData.total_amount) {
        showNotification('error', 'Remaining balance cannot be greater than total amount');
        return;
    }

    try {
        const result = await window.api.updateInstallment(installmentData);
        if (result.success) {
            showNotification('success', result.message);
            closeModal('edit-installment-modal');
            loadInstallments();
            loadDashboard();
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error updating installment: ' + error.message);
    }
});

// Delete Installment
async function deleteInstallment(installmentId) {
    const installment = allInstallments.find(i => i.installment_id === installmentId);
    if (installment && installment.remaining_balance > 0) {
        showNotification('error', 'Please return the product first before deleting the installment plan.');
        return;
    }

    const isConfirmed = await appConfirm('Are you sure you want to delete this installment plan? This action cannot be undone and will also delete all payment history associated with this plan.', 'Delete Installment?');
    if (!isConfirmed) return;

    try {
        const result = await window.api.deleteInstallment(installmentId);
        if (result.success) {
            showNotification('success', result.message);
            loadInstallments();
            loadDashboard();
            // Refresh reports if visible
            const reportOutput = document.getElementById('report-output');
            if (reportOutput && !reportOutput.classList.contains('hidden') && lastReportContext && lastReportContext.type) {
                switch (lastReportContext.type) {
                    case 'daily': generateDailyReport(...lastReportContext.args); break;
                    case 'monthly': generateMonthlyReport(...lastReportContext.args); break;
                    case 'installment': generateInstallmentReport(); break;
                    case 'overdue': generateOverdueReport(); break;
                    case 'daterange': generateDateRangeReport(...lastReportContext.args); break;
                }
            }
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error deleting installment: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════
// REPORTS (Placeholder functions)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PAYMENT TRACKING
// ═══════════════════════════════════════════════════════════

async function loadPaymentsTab(filters = {}) {
    try {
        if (!window.api || !window.api.getAllPayments) {
            console.error('API not exposed: getAllPayments');
            return;
        }

        // Include pagination in filters
        const pFilters = {
            ...filters,
            page: currentPaymentsPage,
            pageSize: paymentsPageSize
        };

        const result = await window.api.getAllPayments(pFilters);
        console.log('Payments filter:', pFilters, 'Result:', result);
        if (result.success) {
            renderPaymentsTable(result.payments);
            renderPaymentsPagination(result.totalCount, result.page, result.pageSize, filters);
        } else {
            console.error('Failed to load payments:', result.message);
            showNotification('error', 'Failed to load payments: ' + result.message);
        }
    } catch (error) {
        console.error('Error loading payments:', error);
        showNotification('error', 'Failed to load payments');
    }
}

function renderPaymentsPagination(totalCount, currentPage, pageSize, activeFilters) {
    const container = document.getElementById('payments-pagination');
    if (!container) return;

    // Ensure all values are numbers
    totalCount = parseInt(totalCount) || 0;
    currentPage = parseInt(currentPage) || 1;
    pageSize = parseInt(pageSize) || 10;

    const totalPages = Math.ceil(totalCount / pageSize);

    // Only show if more than 1 page
    if (totalPages <= 1) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    container.innerHTML = `
        <button class="btn btn-sm btn-secondary" ${currentPage === 1 ? 'disabled' : ''} onclick="changePaymentsPage(${currentPage - 1})">
            <i class="fas fa-chevron-left"></i> Prev
        </button>
        <span class="report-page-info">Page ${currentPage} of ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePaymentsPage(${currentPage + 1})">
            Next <i class="fas fa-chevron-right"></i>
        </button>
        <div class="pagination-info" style="margin-left: auto;">
            Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalCount)} of ${totalCount}
        </div>
    `;

    // Global function for page changes
    window.changePaymentsPage = async (page) => {
        if (page < 1 || page > totalPages) return;
        currentPaymentsPage = page;

        // Use currently set filters
        const search = document.getElementById('payment-search').value;
        const startDate = document.getElementById('payment-start-date').value;
        const endDate = document.getElementById('payment-end-date').value;

        await loadPaymentsTab({ search, startDate, endDate });
        document.getElementById('payments-tab').scrollTop = 0;
    };
}

function renderPaymentsTable(payments) {
    const tbody = document.getElementById('payments-tbody');

    if (payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No payments found</td></tr>';
        return;
    }

    tbody.innerHTML = payments.map(p => `
        <tr>
            <td>${formatDate(p.payment_date)}</td>
            <td><a href="#" onclick="viewInvoice(${p.sale_id}); return false;">#${p.sale_id}</a></td>
            <td>${p.customer_name || 'N/A'}</td>
            <td>Rs. ${formatCurrency(p.total_amount)}</td>
            <td class="text-success fw-bold">Rs. ${formatCurrency(p.amount_paid)}</td>
            <td>Rs. ${formatCurrency(p.remaining_balance_after)}</td>
            <td><span class="badge badge-info">${p.payment_method || 'Cash'}</span></td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewPaymentHistory(${p.installment_id})">
                    <i class="fas fa-history"></i> History
                </button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('payment-filter-btn').addEventListener('click', () => {
    const search = document.getElementById('payment-search').value;
    const startDate = document.getElementById('payment-start-date').value;
    const endDate = document.getElementById('payment-end-date').value;

    currentPaymentsPage = 1; // Reset to page 1 on new filter
    loadPaymentsTab({ search, startDate, endDate });
});

// Real-time search for payments
document.getElementById('payment-search').addEventListener('input', debounce((e) => {
    const search = e.target.value;
    const startDate = document.getElementById('payment-start-date').value;
    const endDate = document.getElementById('payment-end-date').value;

    currentPaymentsPage = 1; // Reset to page 1 on new search
    loadPaymentsTab({ search, startDate, endDate });
}, 300));

// ═══════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════

async function generateActivityLogReport() {
    try {
        const limit = parseInt(document.getElementById('activity-log-limit').value) || 20;
        lastReportContext = { type: 'activity', args: [limit] };
        const result = await window.api.getActivityLogs(limit);
        
        if (result.success) {
            const logs = result.logs;
            
            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">User Activity Logs</h2>
                    
                    <div class="report-summary-card">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Logs Shown</div>
                            <div class="report-summary-value primary">${logs.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Current User</div>
                            <div class="report-summary-value success">${currentUser ? currentUser.username : 'Admin'}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th style="width: 20%;">Timestamp</th>
                                    <th style="width: 15%;">User</th>
                                    <th style="width: 20%;">Action</th>
                                    <th style="width: 45%;">Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logs.map(log => `
                                    <tr>
                                        <td>${formatDate(log.timestamp)}</td>
                                        <td style="font-weight: 600; color: var(--primary);">${log.username}</td>
                                        <td><span class="report-badge ${log.action.includes('Failed') || log.action.includes('Delete') ? 'report-badge-danger' : 'report-badge-primary'}">${log.action}</span></td>
                                        <td style="font-size: 0.9em; color: #475569;">${log.details || '-'}</td>
                                    </tr>
                                `).join('')}
                                ${logs.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No activity logs found</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            
            showReport('Activity Logs', html);
        }
    } catch (error) {
        console.error('Error generating activity report:', error);
        showNotification('error', 'Error fetching activity logs');
    }
}

// Add event listener for the generate button
document.getElementById('generate-activity-report-btn')?.addEventListener('click', generateActivityLogReport);


async function generateDailyReport(date) {
    try {
        lastReportContext = { type: 'daily', args: [date] };
        const result = await window.api.getDailySalesReport(date);
        if (result.success) {
            const { sales, date } = result;
            const totalCash = sales.filter(s => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total_amount, 0);
            const totalInstallment = sales.filter(s => s.payment_type === 'Installment').reduce((sum, s) => sum + (s.down_payment || 0), 0);
            const totalInstallmentPayments = sales.filter(s => s.payment_type === 'Installment Payment').reduce((sum, s) => sum + s.total_amount, 0);
            const total = totalCash + totalInstallment + totalInstallmentPayments;

            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">Daily Sales Report</h2>
                    
                    <div class="report-summary-card">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Report Date</div>
                            <div class="report-summary-value primary" style="font-size: 1.25rem;">${formatDate(date)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Transactions</div>
                            <div class="report-summary-value">${sales.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Cash Sales</div>
                            <div class="report-summary-value success" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalCash)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Installment Receipts</div>
                            <div class="report-summary-value info" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalInstallment + totalInstallmentPayments)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Revenue</div>
                            <div class="report-summary-value success" style="font-size: 1.25rem;">Rs. ${formatCurrency(total)}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Inv #</th>
                                    <th>Product</th>
                                    <th class="text-center">Type</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-center">Invoice</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                    // Use a unique grouping key to prevent merging walk-in and registered customers with same name
                    const groupedSales = {};
                    sales.forEach(s => {
                        const key = (s.customer_id || 0) + '|' + (s.walkin_id || '') + '|' + s.customer_name;
                        if (!groupedSales[key]) groupedSales[key] = [];
                        groupedSales[key].push(s);
                    });

                    return Object.keys(groupedSales).sort((a, b) => {
                        const maxIdA = Math.max(...groupedSales[a].map(s => s.sale_id));
                        const maxIdB = Math.max(...groupedSales[b].map(s => s.sale_id));
                        return maxIdB - maxIdA;
                    }).map(groupKey => {
                        const customerSales = groupedSales[groupKey];
                        const customerName = groupKey.split('|')[2];
                        
                        // Sort so Installment comes before Installment Payment for the same date
                        customerSales.sort((a, b) => {
                            if (a.sale_id !== b.sale_id) return b.sale_id - a.sale_id;
                            if (a.payment_type === 'Installment' && b.payment_type !== 'Installment') return -1;
                            if (b.payment_type === 'Installment' && a.payment_type !== 'Installment') return 1;
                            const dateA = new Date(a.sale_date).getTime();
                            const dateB = new Date(b.sale_date).getTime();
                            return dateB - dateA;
                        });

                        const customerTotal = customerSales.reduce((sum, s) => {
                            const amt = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                            return sum + amt;
                        }, 0);

                        let groupHtml = `
                                    <tr class="report-group-header" style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1;">
                                        <td colspan="5" style="font-weight: bold; color: var(--primary);">
                                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                                <div>
                                                    <i class="fas fa-user-circle" style="margin-right: 8px;"></i>${customerName}
                                                    ${(!customerSales[0].customer_id || customerSales[0].customer_id === '0') && !customerSales.some(s => s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? '<span class="report-badge report-badge-info" style="margin-left:8px; font-size:0.6rem;">Direct Purchase</span>' : ''}
                                                </div>
                                                <div style="font-size: 0.85em; color: #64748b; font-weight: normal;">
                                                    <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${customerSales[0].id_number || (customerSales[0].walkin_id ? 'W-' + customerSales[0].walkin_id : 'N/A')}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>`;

                        groupHtml += customerSales.map(s => {
                            const displayAmount = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                            let badgeClass = 'report-badge-primary';
                            if (s.payment_type === 'Cash') badgeClass = 'report-badge-success';
                            if (s.payment_type === 'Installment Payment') badgeClass = 'report-badge-info';
                            
                            const prodText = s.product_names ? s.product_names : (s.payment_type === 'Installment Payment' ? 'Installment Payment' : 'N/A');

                            return `
                                    <tr>
                                        <td style="font-weight: 600;">
                                            #${s.sale_id}
                                            ${s.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${s.sale_id})" style="font-size: 0.5rem; padding: 1px 3px; margin-left: 2px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}
                                        </td>
                                        <td style="color: #64748b; font-size: 0.9em; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${prodText}">↳ ${prodText}</td>
                                        <td class="text-center"><span class="report-badge ${badgeClass}">${s.payment_type}</span></td>
                                        <td class="text-right" style="font-weight: 600;">Rs. ${formatCurrency(displayAmount)}</td>
                                        <td class="text-center">
                                            <div style="display: flex; gap: 4px; justify-content: center;">
                                                <button class="btn btn-sm btn-primary" onclick="viewInvoice(${s.sale_id})" title="View"><i class="fas fa-file-invoice"></i></button>
                                                <button class="btn btn-sm btn-outline-danger" onclick="openReturnModal(${s.sale_id})" title="Return"><i class="fas fa-undo"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                    `;
                        }).join('');

                        groupHtml += `
                                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                                        <td colspan="3" class="text-right" style="font-weight: bold; color: #64748b; font-size: 0.85em; vertical-align: middle;">Subtotal for ${customerName}:</td>
                                        <td class="text-right" style="font-weight: bold; color: var(--success); font-size: 1.05em; border-top: 1px solid #e2e8f0;">Rs. ${formatCurrency(customerTotal)}</td>
                                        <td></td>
                                    </tr>`;

                        return groupHtml;
                    }).join('');
                })()}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <th colspan="3" class="text-left" style="padding-left: 15px;">Total Sales Revenue: <span style="color: var(--success); margin-left: 10px; font-size: 1.1em;">Rs. ${formatCurrency(total)}</span></th>
                                    <th colspan="2"></th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;

            showReport('Daily Sales Report', html);
        }
    } catch (error) {
        console.error('Error generating daily report:', error);
        showNotification('error', 'Error generating daily report');
    }
}

async function generateMonthlyReport() {
    try {
        lastReportContext = { type: 'monthly', args: [] };
        const result = await window.api.getMonthlySalesReport();
        if (result.success) {
            const { sales, month } = result;
            const totalCash = sales.filter(s => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total_amount, 0);
            const totalInstallment = sales.filter(s => s.payment_type === 'Installment').reduce((sum, s) => sum + (s.down_payment || 0), 0);
            const totalInstallmentPayments = sales.filter(s => s.payment_type === 'Installment Payment').reduce((sum, s) => sum + s.total_amount, 0);
            const total = totalCash + totalInstallment + totalInstallmentPayments;

            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">Monthly Sales Report</h2>
                    
                    <div class="report-summary-card">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Reporting Month</div>
                            <div class="report-summary-value primary" style="font-size: 1.25rem;">${month}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Transactions</div>
                            <div class="report-summary-value">${sales.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Cash Sales</div>
                            <div class="report-summary-value success" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalCash)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Installment Receipts</div>
                            <div class="report-summary-value info" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalInstallment + totalInstallmentPayments)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Revenue</div>
                            <div class="report-summary-value success" style="font-size: 1.25rem;">Rs. ${formatCurrency(total)}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Inv #</th>
                                    <th>Date</th>
                                    <th>Product</th>
                                    <th class="text-center">Type</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-center">Invoice</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                    // Use a unique grouping key to prevent merging walk-in and registered customers with same name
                    const groupedSales = {};
                    sales.forEach(s => {
                        const key = (s.customer_id || 0) + '|' + (s.walkin_id || '') + '|' + s.customer_name;
                        if (!groupedSales[key]) groupedSales[key] = [];
                        groupedSales[key].push(s);
                    });

                    return Object.keys(groupedSales).sort((a, b) => {
                        const maxIdA = Math.max(...groupedSales[a].map(s => s.sale_id));
                        const maxIdB = Math.max(...groupedSales[b].map(s => s.sale_id));
                        return maxIdB - maxIdA;
                    }).map(groupKey => {
                        const customerSales = groupedSales[groupKey];
                        const customerName = groupKey.split('|')[2];
                        
                        // Sort so Installment comes before Installment Payment for the same date
                        customerSales.sort((a, b) => {
                            if (a.sale_id !== b.sale_id) return b.sale_id - a.sale_id;
                            if (a.payment_type === 'Installment' && b.payment_type !== 'Installment') return -1;
                            if (b.payment_type === 'Installment' && a.payment_type !== 'Installment') return 1;
                            const dateA = new Date(a.sale_date).getTime();
                            const dateB = new Date(b.sale_date).getTime();
                            return dateB - dateA;
                        });

                        const customerTotal = customerSales.reduce((sum, s) => {
                            const amt = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                            return sum + amt;
                        }, 0);

                        let groupHtml = `
                                    <tr class="report-group-header" style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1;">
                                        <td colspan="6" style="font-weight: bold; color: var(--primary);">
                                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                                <div>
                                                    <i class="fas fa-user-circle" style="margin-right: 8px;"></i>${customerName}
                                                    ${(!customerSales[0].customer_id || customerSales[0].customer_id === '0') && !customerSales.some(s => s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? '<span class="report-badge report-badge-info" style="margin-left:8px; font-size:0.6rem;">Direct Purchase</span>' : ''}
                                                </div>
                                                <div style="font-size: 0.85em; color: #64748b; font-weight: normal;">
                                                    <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${customerSales[0].id_number || (customerSales[0].walkin_id ? 'W-' + customerSales[0].walkin_id : 'N/A')}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>`;

                        groupHtml += customerSales.map(s => {
                            const displayAmount = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                            let badgeClass = 'report-badge-primary';
                            if (s.payment_type === 'Cash') badgeClass = 'report-badge-success';
                            if (s.payment_type === 'Installment Payment') badgeClass = 'report-badge-info';
                            
                            const prodText = s.product_names ? s.product_names : (s.payment_type === 'Installment Payment' ? 'Installment Payment' : 'N/A');

                            return `
                                    <tr>
                                        <td style="font-weight: 600;">
                                            #${s.sale_id}
                                            ${s.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${s.sale_id})" style="font-size: 0.5rem; padding: 1px 3px; margin-left: 2px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}
                                        </td>
                                        <td>${formatDate(s.sale_date)}</td>
                                        <td style="color: #64748b; font-size: 0.9em; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${prodText}">↳ ${prodText}</td>
                                        <td class="text-center"><span class="report-badge ${badgeClass}">${s.payment_type}</span></td>
                                        <td class="text-right" style="font-weight: 600;">Rs. ${formatCurrency(displayAmount)}</td>
                                        <td class="text-center">
                                            <div style="display: flex; gap: 4px; justify-content: center;">
                                                <button class="btn btn-sm btn-primary" onclick="viewInvoice(${s.sale_id})" title="View"><i class="fas fa-file-invoice"></i></button>
                                                <button class="btn btn-sm btn-outline-danger" onclick="openReturnModal(${s.sale_id})" title="Return"><i class="fas fa-undo"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                        }).join('');
                        
                        groupHtml += `
                                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                                        <td colspan="4" class="text-right" style="font-weight: bold; color: #64748b; font-size: 0.85em; vertical-align: middle;">Subtotal for ${customerName}:</td>
                                        <td class="text-right" style="font-weight: bold; color: var(--success); font-size: 1.05em; border-top: 1px solid #e2e8f0;">Rs. ${formatCurrency(customerTotal)}</td>
                                        <td></td>
                                    </tr>`;

                        return groupHtml;
                    }).join('');
                })()}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <th colspan="4" class="text-left" style="padding-left: 15px;">Total Monthly Revenue: <span style="color: var(--success); margin-left: 10px; font-size: 1.1em;">Rs. ${formatCurrency(total)}</span></th>
                                    <th colspan="2"></th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;

            showReport('Monthly Sales Report', html);
        }
    } catch (error) {
        console.error('Error generating monthly report:', error);
        showNotification('error', 'Error generating monthly report');
    }
}

async function generateInstallmentReport() {
    try {
        lastReportContext = { type: 'installment', args: [] };
        const result = await window.api.getInstallmentReport();
        if (result.success) {
            const installments = result.installments;

            const activeCount = installments.filter(i => i.status === 'Active').length;
            const overdueCount = installments.filter(i => i.status === 'Overdue').length;
            const completedCount = installments.filter(i => i.status === 'Completed').length;
            const totalRemaining = installments.reduce((sum, i) => sum + i.remaining_balance, 0);

            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">Installments Overview Report</h2>
                    
                    <div class="report-summary-card">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Active Plans</div>
                            <div class="report-summary-value primary">${activeCount}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Overdue Plans</div>
                            <div class="report-summary-value danger">${overdueCount}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Completed Plans</div>
                            <div class="report-summary-value success">${completedCount}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Outstanding Balance</div>
                            <div class="report-summary-value warning" style="font-size: 1.25rem;">Rs. ${formatCurrency(totalRemaining)}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Phone</th>
                                    <th class="text-right">Total</th>
                                    <th class="text-right">Remaining</th>
                                    <th class="text-center">Next Due</th>
                                    <th class="text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                    // Use a unique grouping key to prevent merging walk-in and registered customers with same name
                    const groupedInstallments = {};
                    installments.forEach(i => {
                        const key = (i.customer_id || 0) + '|' + (i.walkin_id || '') + '|' + i.customer_name;
                        if (!groupedInstallments[key]) groupedInstallments[key] = [];
                        groupedInstallments[key].push(i);
                    });

                    return Object.keys(groupedInstallments).sort((a, b) => {
                        const nameA = a.split('|')[2].toLowerCase();
                        const nameB = b.split('|')[2].toLowerCase();
                        return nameA.localeCompare(nameB);
                    }).map(groupKey => {
                        const customerInstalls = groupedInstallments[groupKey];
                        const customerName = groupKey.split('|')[2];
                        const customerRemaining = customerInstalls.reduce((sum, i) => sum + i.remaining_balance, 0);

                        let groupHtml = `
                                    <tr class="report-group-header" style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1;">
                                        <td colspan="6" style="font-weight: bold; color: var(--primary); padding: 8px 15px;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                                <div>
                                                    <i class="fas fa-user-circle" style="margin-right: 8px;"></i>${customerName}
                                                    ${(!customerInstalls[0].customer_id || customerInstalls[0].customer_id === '0') && !customerInstalls.some(i => i.payment_type === 'Installment' || i.payment_type === 'Installment Payment') ? '<span class="report-badge report-badge-info" style="margin-left:8px; font-size:0.6rem;">Direct Purchase</span>' : ''}
                                                    <span style="font-size: 0.8em; font-weight: normal; color: #64748b; margin-left: 10px;">(Phone: ${customerInstalls[0].phone || '-'})</span>
                                                </div>
                                                <div style="display: flex; align-items: center; gap: 20px;">
                                                    <div style="font-size: 0.85em; color: #64748b; font-weight: normal;">
                                                        <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${customerInstalls[0].id_number || (customerInstalls[0].walkin_id ? 'W-' + customerInstalls[0].walkin_id : 'N/A')}
                                                    </div>
                                                    <div style="font-weight: bold; color: var(--warning);">
                                                        <span style="font-size: 0.8rem; color: #64748b; margin-right: 5px;">Remaining:</span>Rs. ${formatCurrency(customerRemaining)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>`;

                        groupHtml += customerInstalls.map(i => {
                            let badgeClass = 'report-badge-secondary';
                            if (i.status === 'Active') badgeClass = 'report-badge-success';
                            else if (i.status === 'Overdue') badgeClass = 'report-badge-danger';
                            else if (i.status === 'Completed') badgeClass = 'report-badge-primary';

                            return `
                                    <tr>
                                        <td style="font-weight: 600; padding-left: 20px;">
                                            Inv #${i.sale_id}
                                            ${i.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${i.sale_id})" style="font-size: 0.6rem; padding: 2px 4px; margin-left: 5px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}
                                        </td>
                                        <td style="color: #64748b; font-style: italic; font-size: 0.9em;">↳ Plan Detail</td>
                                        <td class="text-right">Rs. ${formatCurrency(i.total_amount)}</td>
                                        <td class="text-right" style="font-weight: 600; color: var(--warning);">Rs. ${formatCurrency(i.remaining_balance)}</td>
                                        <td class="text-center">${formatDate(i.next_due_date)}</td>
                                        <td class="text-center">
                                            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                                <span class="report-badge ${badgeClass}">${i.status}</span>
                                                <button class="btn btn-xs btn-outline-danger" onclick="openReturnModal(${i.sale_id})" title="Return" style="font-size: 0.7rem; padding: 1px 5px;"><i class="fas fa-undo"></i> Return</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                        }).join('');
                        return groupHtml;
                    }).join('');
                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            showReport('Installment Report', html);
        }
    } catch (error) {
        showNotification('error', 'Error generating installment report');
    }
}

async function generateOverdueReport() {
    try {
        lastReportContext = { type: 'overdue', args: [] };
        const result = await window.api.getOverdueReport();
        if (result.success) {
            const installments = result.installments;

            const totalOverdueAmount = installments.reduce((sum, i) => sum + i.monthly_amount, 0);

            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--danger); font-weight: 800; letter-spacing: 0.5px;">Overdue Payments Action Report</h2>
                    
                    <div class="report-summary-card" style="border-color: rgba(239, 68, 68, 0.2); background: linear-gradient(135deg, #ffffff 0%, #fef2f2 100%);">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Overdue Accounts</div>
                            <div class="report-summary-value danger">${installments.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Expected Overdue Value</div>
                            <div class="report-summary-value danger" style="font-size: 1.5rem;">Rs. ${formatCurrency(totalOverdueAmount)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Report Date</div>
                            <div class="report-summary-value primary" style="font-size: 1.25rem;">${formatDate(new Date())}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Contact</th>
                                    <th>Address</th>
                                    <th class="text-right">Monthly Due</th>
                                    <th class="text-center">Due Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                    // Use a unique grouping key to prevent merging walk-in and registered customers with same name
                    const grouped = {};
                    installments.forEach(i => {
                        const key = (i.customer_id || 0) + '|' + (i.walkin_id || '') + '|' + i.customer_name;
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(i);
                    });

                    return Object.keys(grouped).sort((a, b) => {
                        const nameA = a.split('|')[2].toLowerCase();
                        const nameB = b.split('|')[2].toLowerCase();
                        return nameA.localeCompare(nameB);
                    }).map(groupKey => {
                        const items = grouped[groupKey];
                        const customerName = groupKey.split('|')[2];
                        let groupRows = `
                                    <tr class="report-group-header" style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1;">
                                        <td colspan="5" style="font-weight: bold; color: var(--primary); padding: 8px 15px;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                                <div>
                                                    <i class="fas fa-user-circle" style="margin-right: 8px;"></i>${customerName}
                                                    ${(!items[0].customer_id || items[0].customer_id === '0') && !items.some(s => s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? '<span class="report-badge report-badge-info" style="margin-left:8px; font-size:0.6rem;">Direct Purchase</span>' : ''}
                                                </div>
                                                <div style="font-size: 0.85em; color: #64748b; font-weight: normal;">
                                                    <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${items[0].id_number || (items[0].walkin_id ? 'W-' + items[0].walkin_id : 'N/A')}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>`;
                        
                        groupRows += items.map(i => `
                                    <tr>
                                        <td style="font-weight: 600; padding-left: 20px;">
                                            ↳ Inv #${i.sale_id}
                                            ${i.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${i.sale_id})" style="font-size: 0.6rem; padding: 2px 4px; margin-left: 5px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}
                                        </td>
                                        <td>${i.phone}</td>
                                        <td style="color: var(--text-secondary);">${i.address || 'N/A'}</td>
                                        <td class="text-right" style="color: var(--danger); font-weight: 700;">Rs. ${formatCurrency(i.monthly_amount)}</td>
                                        <td class="text-center">
                                            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                                <span class="report-badge report-badge-danger">${formatDate(i.next_due_date)}</span>
                                                <button class="btn btn-xs btn-outline-danger" onclick="openReturnModal(${i.sale_id})" title="Return" style="font-size: 0.7rem; padding: 1px 5px;"><i class="fas fa-undo"></i> Return</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('');
                        return groupRows;
                    }).join('');
                })()}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <th colspan="3" class="text-right">Total Overdue Expected:</th>
                                    <th class="text-right" style="color: var(--danger);">Rs. ${formatCurrency(totalOverdueAmount)}</th>
                                    <th></th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;

            showReport('Overdue Report', html);
        }
    } catch (error) {
        showNotification('error', 'Error generating overdue report');
    }
}

async function generateInventoryReport() {
    try {
        console.log('Requesting Inventory Report...');
        const result = await window.api.getInventoryReport();
        console.log('Inventory Report Result:', result);

        if (result.success) {
            const { products, summary } = result;

            if (!products || !Array.isArray(products)) {
                console.error('Invalid products data:', products);
                showNotification('error', 'Received invalid data for inventory report');
                return;
            }

            if (products.length === 0) {
                showReport('Inventory Report', '<p class="text-center text-muted">No items found in inventory.</p>');
                return;
            }

            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">Inventory Status Report</h2>
                    
                    <div class="report-summary-card">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Product Types</div>
                            <div class="report-summary-value primary">${products.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Stock Quantity</div>
                            <div class="report-summary-value">${summary.totalStock}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Estimated Inventory Value</div>
                            <div class="report-summary-value success" style="font-size: 1.5rem;">Rs. ${formatCurrency(summary.totalValue)}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Category</th>
                                    <th>Brand</th>
                                    <th class="text-right">Stock</th>
                                    <th class="text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                    const groupedProducts = groupByKey(products, 'category');
                    return Object.keys(groupedProducts).sort().map(category => {
                        const items = groupedProducts[category];
                        // Sort items alphabetically within category
                        items.sort((a, b) => a.name.localeCompare(b.name));

                        let groupHtml = `
                                        <tr style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1;">
                                            <td colspan="5" style="font-weight: bold; color: var(--primary);"><i class="fas fa-layer-group" style="margin-right: 8px;"></i>Category: ${category || 'Uncategorized'}</td>
                                        </tr>`;

                        groupHtml += items.map(p => {
                            const isLowStock = p.stock_qty <= p.min_stock_level;
                            const trStyle = isLowStock ? 'background-color: #fffbfa;' : '';
                            const stockColor = isLowStock ? 'color: var(--danger); font-weight: bold;' : '';

                            return `
                                            <tr style="${trStyle}">
                                                <td style="font-weight: 600; padding-left: 20px;">${p.name}
                                                    ${isLowStock ? '<span class="report-badge report-badge-danger" style="margin-left:8px; font-size:0.6rem;">Low Stock</span>' : ''}
                                                </td>
                                                <td style="color: #64748b; font-style: italic; font-size: 0.9em;">↳ Product</td>
                                                <td>${p.brand || '-'}</td>
                                                <td class="text-right" style="${stockColor}">${p.stock_qty}</td>
                                                <td class="text-right">Rs. ${formatCurrency(p.purchase_price * p.stock_qty)}</td>
                                            </tr>
                                        `;
                        }).join('');
                        return groupHtml;
                    }).join('');
                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            showReport('Inventory Report', html);
        } else {
            console.error('Inventory Report Failed:', result.message);
            showNotification('error', 'Failed to generate inventory report: ' + result.message);
        }
    } catch (error) {
        console.error('Error in generateInventoryReport:', error);
        showNotification('error', 'Error generating inventory report');
    }
}

document.getElementById('generate-profit-report-btn').addEventListener('click', async () => {
    const startDate = document.getElementById('profit-start-date').value;
    const endDate = document.getElementById('profit-end-date').value;

    if (!startDate || !endDate) {
        showNotification('error', 'Please select both start and end dates.');
        return;
    }

    if (startDate > endDate) {
        showNotification('error', 'Start date cannot be after end date.');
        return;
    }

    try {
        const result = await window.api.getProfitLossReport({ startDate, endDate });
        if (result.success) {
            let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">Profit & Loss Statement</h2>
                    
                    <div class="report-summary-card" style="max-width: 500px; margin: 0 auto 2rem; border-color: ${result.profit >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};">
                        <div class="report-summary-item">
                            <div class="report-summary-label">Period Start</div>
                            <div class="report-summary-value primary" style="font-size: 1.1rem;">${formatDate(startDate)}</div>
                        </div>
                        <div class="report-summary-item" style="border-left: 1px solid var(--dark-border); border-right: 1px solid var(--dark-border); padding: 0 1rem;">
                            <div class="report-summary-label">Net ${result.profit >= 0 ? 'Profit' : 'Loss'}</div>
                            <div class="report-summary-value ${result.profit >= 0 ? 'success' : 'danger'}" style="font-size: 2rem;">Rs. ${formatCurrency(Math.abs(result.profit))}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Period End</div>
                            <div class="report-summary-value primary" style="font-size: 1.1rem;">${formatDate(endDate)}</div>
                        </div>
                    </div>
                    
                    <div class="report-table-container" style="max-width: 600px; margin: 0 auto; border-top: 4px solid var(--primary);">
                        <table class="report-table">
                            <tbody>
                                <tr>
                                    <td style="font-size: 1.1rem; padding: 1.5rem;">Total Revenue (Sales)</td>
                                    <td class="text-right" style="font-size: 1.1rem; font-weight: 700; color: var(--success); padding: 1.5rem;">Rs. ${formatCurrency(result.revenue)}</td>
                                </tr>
                                <tr>
                                    <td style="font-size: 1.1rem; padding: 1.5rem;">Cost of Goods Sold</td>
                                    <td class="text-right" style="font-size: 1.1rem; font-weight: 700; color: var(--danger); padding: 1.5rem;">(Rs. ${formatCurrency(result.cost)})</td>
                                </tr>
                            </tbody>
                            <tfoot style="background: ${result.profit >= 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)'};">
                                <tr>
                                    <th style="font-size: 1.25rem; font-weight: 800; padding: 1.5rem;">Net Profit / (Loss)</th>
                                    <th class="text-right" style="font-size: 1.5rem; font-weight: 800; color: ${result.profit >= 0 ? 'var(--success)' : 'var(--danger)'}; padding: 1.5rem;">Rs. ${formatCurrency(result.profit)}</th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;

            showReport('Profit & Loss Report', html);
        } else {
            showNotification('error', 'Error from server: ' + result.message);
        }
    } catch (error) {
        console.error('Error generating profit report:', error);
        showNotification('error', 'Error generating profit report');
    }
});

// ═══════════════════════════════════════════════════════════
// REPORT PAGINATION STATE
// ═══════════════════════════════════════════════════════════
const REPORT_PAGE_SIZE = 5;
let reportPagination = { currentPage: 1, totalPages: 1, allRows: [] };

function showReport(title, content) {
    document.getElementById('report-title').textContent = title;
    document.getElementById('report-content').innerHTML = content;
    document.getElementById('report-output').classList.remove('hidden');
    // Clear search when showing new report
    const searchInput = document.getElementById('report-search');
    if (searchInput) searchInput.value = '';
    // Initialize pagination
    initReportPagination();
}

function initReportPagination() {
    const reportContent = document.getElementById('report-content');
    const rows = Array.from(reportContent.querySelectorAll('.report-table tbody tr'));
    reportPagination.allRows = rows;
    reportPagination.currentPage = 1;
    applyReportPagination(rows);
}

function applyReportPagination(rows) {
    // Detect if we are using grouping (headers)
    const headers = rows.filter(row => row.classList.contains('report-group-header'));
    const isGrouped = headers.length > 0;

    const totalItems = isGrouped ? headers.length : rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / REPORT_PAGE_SIZE));
    reportPagination.totalPages = totalPages;

    // Clamp current page
    if (reportPagination.currentPage > totalPages) reportPagination.currentPage = totalPages;
    if (reportPagination.currentPage < 1) reportPagination.currentPage = 1;

    const startIdx = (reportPagination.currentPage - 1) * REPORT_PAGE_SIZE;
    const endIdx = startIdx + REPORT_PAGE_SIZE;

    // Hide all rows initially
    reportPagination.allRows.forEach(row => (row.style.display = 'none'));

    if (isGrouped) {
        // Show groups within the range
        let visibleGroups = 0;
        let showingRow = false;

        rows.forEach(row => {
            if (row.classList.contains('report-group-header')) {
                const groupIdx = headers.indexOf(row);
                if (groupIdx >= startIdx && groupIdx < endIdx) {
                    row.style.display = '';
                    showingRow = true;
                    visibleGroups++;
                } else {
                    showingRow = false;
                }
            } else if (showingRow) {
                row.style.display = '';
            }
        });
    } else {
        // Simple row pagination
        rows.forEach((row, index) => {
            row.style.display = index >= startIdx && index < endIdx ? '' : 'none';
        });
    }

    // Update pagination controls
    const paginationEl = document.getElementById('report-pagination');
    if (totalItems <= REPORT_PAGE_SIZE) {
        paginationEl.classList.add('hidden');
    } else {
        paginationEl.classList.remove('hidden');
    }
    document.getElementById('report-page-info').textContent = `Page ${reportPagination.currentPage} of ${totalPages}`;
    document.getElementById('report-prev-page').disabled = reportPagination.currentPage <= 1;
    document.getElementById('report-next-page').disabled = reportPagination.currentPage >= totalPages;
}

// Pagination buttons
document.getElementById('report-prev-page').addEventListener('click', () => {
    if (reportPagination.currentPage > 1) {
        reportPagination.currentPage--;
        applyReportPagination(getFilteredRows());
    }
});

document.getElementById('report-next-page').addEventListener('click', () => {
    if (reportPagination.currentPage < reportPagination.totalPages) {
        reportPagination.currentPage++;
        applyReportPagination(getFilteredRows());
    }
});

function getFilteredRows() {
    const query = (document.getElementById('report-search').value || '').toLowerCase().trim();
    if (!query) return reportPagination.allRows;

    // Detect if we are using grouping (headers)
    const rows = reportPagination.allRows;
    const headers = rows.filter(row => row.classList.contains('report-group-header'));
    const isGrouped = headers.length > 0;

    if (!isGrouped) {
        return rows.filter(row => row.textContent.toLowerCase().includes(query));
    }

    // For grouped reports: If a group match, keep header + all its children
    const filteredRows = [];
    let currentGroupMatches = false;
    let currentGroupRows = [];

    rows.forEach(row => {
        if (row.classList.contains('report-group-header')) {
            // New group started - finalize previous group
            if (currentGroupMatches) {
                filteredRows.push(...currentGroupRows);
            }
            
            // Check if THIS header matches
            currentGroupMatches = row.textContent.toLowerCase().includes(query);
            currentGroupRows = [row];
        } else {
            // This is a transaction row. 
            // 1. If header already matched, the group matches.
            // 2. Otherwise, if this row matches, the WHOLE group (including header) should be shown.
            currentGroupRows.push(row);
            if (row.textContent.toLowerCase().includes(query)) {
                currentGroupMatches = true;
            }
        }
    });

    // Finalize last group
    if (currentGroupMatches) {
        filteredRows.push(...currentGroupRows);
    }

    return filteredRows;
}

// ═══════════════════════════════════════════════════════════
// REPORT SUB-TAB SWITCHING
// ═══════════════════════════════════════════════════════════

document.querySelectorAll('.report-sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active from all sub-tabs
        document.querySelectorAll('.report-sub-tab').forEach(t => t.classList.remove('active'));
        // Add active to clicked sub-tab
        tab.classList.add('active');

        // Hide all filter panels
        document.querySelectorAll('.report-filter-panel').forEach(p => p.classList.remove('active'));
        // Show the matching panel
        const panelId = 'report-panel-' + tab.getAttribute('data-report-tab');
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');

        // Hide report output when switching tabs
        document.getElementById('report-output').classList.add('hidden');
    });
});

// ═══════════════════════════════════════════════════════════
// REPORT SEARCH (filter + re-paginate)
// ═══════════════════════════════════════════════════════════

document.getElementById('report-search').addEventListener('input', debounce(function () {
    reportPagination.currentPage = 1; // Reset to page 1 on search
    const filtered = getFilteredRows();
    applyReportPagination(filtered);
}, 300));

document.getElementById('sales-report-type').addEventListener('change', function () {
    const customDates = document.getElementById('sales-custom-dates');
    if (this.value === 'custom') {
        customDates.style.display = 'flex';
    } else {
        customDates.style.display = 'none';
    }
});

document.getElementById('generate-sales-report-btn').addEventListener('click', async () => {
    const type = document.getElementById('sales-report-type').value;

    if (type === 'daily') {
        await generateDailyReport();
    } else if (type === 'monthly') {
        await generateMonthlyReport();
    } else if (type === 'overall') {
        // Overall means from the beginning of time to far future to get all records
        await generateDateRangeReport('2000-01-01', '2100-12-31', 'Overall Sales Report');
    } else if (type === 'custom') {
        const startDate = document.getElementById('report-start-date').value;
        const endDate = document.getElementById('report-end-date').value;

        if (!startDate || !endDate) {
            showNotification('error', 'Please select both start and end dates.');
            return;
        }

        if (startDate > endDate) {
            showNotification('error', 'Start date cannot be after end date.');
            return;
        }

        await generateDateRangeReport(startDate, endDate, 'Custom Date Range Sales Report');
    }
});

document.getElementById('report-clear-btn').addEventListener('click', () => {
    document.getElementById('report-start-date').value = '';
    document.getElementById('report-end-date').value = '';
    document.getElementById('report-output').classList.add('hidden');
});

document.getElementById('generate-installments-report-btn').addEventListener('click', async () => {
    const type = document.getElementById('installments-report-type').value;
    if (type === 'due') {
        await generateInstallmentReport();
    } else if (type === 'overdue') {
        await generateOverdueReport();
    }
});

document.getElementById('generate-inventory-report-btn').addEventListener('click', async () => {
    await generateInventoryReport();
});

async function generateDateRangeReport(startDate, endDate, title = 'Sales Report') {
    try {
        lastReportContext = { type: 'daterange', args: [startDate, endDate, title] };
        const result = await window.api.getSalesReportByDateRange({ startDate, endDate });
        if (!result || !result.success) {
            showNotification('error', 'Failed to generate report: ' + (result ? result.message : 'No response'));
            return;
        }

        const { sales } = result;
        const totalCash = sales.filter(s => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total_amount, 0);
        const totalInstallment = sales.filter(s => s.payment_type === 'Installment').reduce((sum, s) => sum + (s.down_payment || 0), 0);
        const totalInstallmentPayments = sales.filter(s => s.payment_type === 'Installment Payment').reduce((sum, s) => sum + s.total_amount, 0);
        const total = totalCash + totalInstallment + totalInstallmentPayments;

        let dateRangeHTML = '';
        if (title !== 'Overall Sales Report') {
            dateRangeHTML = `
                <div class="report-summary-item">
                    <div class="report-summary-label">From</div>
                    <div class="report-summary-value primary" style="font-size: 1.1rem;">${formatDate(startDate)}</div>
                </div>
                <div class="report-summary-item">
                    <div class="report-summary-label">To</div>
                    <div class="report-summary-value primary" style="font-size: 1.1rem;">${formatDate(endDate)}</div>
                </div>
            `;
        }

        let html = `
                <div class="printable-report" style="color: #000;">
                    <h2 class="text-center" style="margin-bottom: 2rem; color: var(--text-primary); font-weight: 800; letter-spacing: 0.5px;">${title}</h2>
                    
                    <div class="report-summary-card">
                        ${dateRangeHTML}
                        <div class="report-summary-item">
                            <div class="report-summary-label">Transactions</div>
                            <div class="report-summary-value">${sales.length}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Cash Sales</div>
                            <div class="report-summary-value success" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalCash)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Installment Receipts</div>
                            <div class="report-summary-value info" style="font-size: 1.1rem;">Rs. ${formatCurrency(totalInstallment + totalInstallmentPayments)}</div>
                        </div>
                        <div class="report-summary-item">
                            <div class="report-summary-label">Total Revenue</div>
                            <div class="report-summary-value success" style="font-size: 1.25rem;">Rs. ${formatCurrency(total)}</div>
                        </div>
                    </div>

                    <div class="report-table-container">
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Inv #</th>
                                    <th>Date</th>
                                    <th>Product</th>
                                    <th class="text-center">Type</th>
                                    <th class="text-right">Amount</th>
                                    <th class="text-center">Invoice</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sales.length === 0 ? '<tr><td colspan="6" class="text-center text-muted" style="padding: 2rem;">No sales found in this date range</td></tr>' : (() => {
                // Use a unique grouping key to prevent merging walk-in and registered customers with same name
                const groupedSales = {};
                sales.forEach(s => {
                    const key = (s.customer_id || 0) + '|' + (s.walkin_id || '') + '|' + s.customer_name;
                    if (!groupedSales[key]) groupedSales[key] = [];
                    groupedSales[key].push(s);
                });

                return Object.keys(groupedSales).sort((a, b) => {
                        const maxIdA = Math.max(...groupedSales[a].map(s => s.sale_id));
                        const maxIdB = Math.max(...groupedSales[b].map(s => s.sale_id));
                        return maxIdB - maxIdA;
                    }).map(groupKey => {
                    const customerSales = groupedSales[groupKey];
                    const customerName = groupKey.split('|')[2];
                    
                    // Sort so Installment comes before Installment Payment for the same date
                    customerSales.sort((a, b) => {
                            if (a.sale_id !== b.sale_id) return b.sale_id - a.sale_id;
                        if (a.payment_type === 'Installment' && b.payment_type !== 'Installment') return -1;
                        if (b.payment_type === 'Installment' && a.payment_type !== 'Installment') return 1;
                        const dateA = new Date(a.sale_date).getTime();
                        const dateB = new Date(b.sale_date).getTime();
                        return dateB - dateA;
                        });

                    const customerTotal = customerSales.reduce((sum, s) => {
                        const amt = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                        return sum + amt;
                    }, 0);

                    let groupHtml = `
                                    <tr class="report-group-header" style="background-color: #f1f5f9; border-top: 2px solid #cbd5e1;">
                                        <td colspan="6" style="font-weight: bold; color: var(--primary);">
                                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                                <div>
                                                    <i class="fas fa-user-circle" style="margin-right: 8px;"></i>${customerName}
                                                    ${!customerSales[0].customer_id || customerSales[0].customer_id === '0' ? '<span class="report-badge report-badge-info" style="margin-left:8px; font-size:0.6rem;">Direct Purchase</span>' : ''}
                                                </div>
                                                <div style="font-size: 0.85em; color: #64748b; font-weight: normal;">
                                                    <i class="fas fa-id-card" style="margin-right: 4px;"></i>CNIC: ${customerSales[0].id_number || (customerSales[0].walkin_id ? 'W-' + customerSales[0].walkin_id : 'N/A')}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>`;

                    groupHtml += customerSales.map(s => {
                        const displayAmount = (s.payment_type === 'Installment' || s.payment_type === 'Installment Payment') ? (s.down_payment || 0) : s.total_amount;
                        let badgeClass = 'report-badge-primary';
                        if (s.payment_type === 'Cash') badgeClass = 'report-badge-success';
                        if (s.payment_type === 'Installment Payment') badgeClass = 'report-badge-info';
                        
                        const prodText = s.product_names ? s.product_names : (s.payment_type === 'Installment Payment' ? 'Installment Payment' : 'N/A');

                        return `
                                    <tr>
                                        <td style="font-weight: 600;">
                                            #${s.sale_id}
                                            ${s.return_count > 0 ? `<span class="badge badge-danger" onclick="viewInvoice(${s.sale_id})" style="font-size: 0.5rem; padding: 1px 3px; margin-left: 2px; cursor: pointer;" title="Click to view return details">Ret</span>` : ''}
                                        </td>
                                        <td>${formatDate(s.sale_date)}</td>
                                        <td style="color: #64748b; font-size: 0.9em; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${prodText}">↳ ${prodText}</td>
                                        <td class="text-center"><span class="report-badge ${badgeClass}">${s.payment_type}</span></td>
                                        <td class="text-right" style="font-weight: 600;">Rs. ${formatCurrency(displayAmount)}</td>
                                        <td class="text-center">
                                            <div style="display: flex; gap: 4px; justify-content: center;">
                                                <button class="btn btn-sm btn-primary" onclick="viewInvoice(${s.sale_id})" title="View"><i class="fas fa-file-invoice"></i></button>
                                                <button class="btn btn-sm btn-outline-danger" onclick="openReturnModal(${s.sale_id})" title="Return"><i class="fas fa-undo"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                    }).join('');

                    groupHtml += `
                                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                                        <td colspan="4" class="text-right" style="font-weight: bold; color: #64748b; font-size: 0.85em; vertical-align: middle;">Subtotal for ${customerName}:</td>
                                        <td class="text-right" style="font-weight: bold; color: var(--success); font-size: 1.05em; border-top: 1px solid #e2e8f0;">Rs. ${formatCurrency(customerTotal)}</td>
                                        <td></td>
                                    </tr>`;

                    return groupHtml;
                }).join('');
            })()}
                            </tbody>
                            ${sales.length > 0 ? `
                            <tfoot>
                                <tr>
                                    <th colspan="4" class="text-left" style="padding-left: 15px;">Total Revenue: <span style="color: var(--success); margin-left: 10px; font-size: 1.1em;">Rs. ${formatCurrency(total)}</span></th>
                                    <th colspan="2"></th>
                                </tr>
                            </tfoot>
                            ` : ''}
                        </table>
                    </div>
                </div>
            `;

        showReport('Sales Report (' + formatDate(startDate) + ' - ' + formatDate(endDate) + ')', html);
    } catch (error) {
        console.error('Error generating date range report:', error);
        showNotification('error', 'Error generating date range report: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS

function groupByKey(array, key) {
    return array.reduce((result, currentValue) => {
        const groupValue = currentValue[key] || 'Unknown';
        (result[groupValue] = result[groupValue] || []).push(currentValue);
        return result;
    }, {});
}
// ═══════════════════════════════════════════════════════════

function openModal(modalId, focusId = null) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');

    if (focusId) {
        // Use a longer timeout to ensure Electron's focus manager and animations settle
        setTimeout(() => {
            const focusEl = document.getElementById(focusId);
            if (focusEl) {
                focusEl.focus();
                if (focusEl.select) focusEl.select();
            }
        }, 150);
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getShopHeaderHTML() {
    return `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #2c3e50; padding-bottom: 10px;">
            <h1 style="color: #2c3e50; margin: 0; font-size: 2.5rem; letter-spacing: 1px; font-weight: 800;">Rasheed Fridge Agency</h1>
            <p style="color: #34495e; margin: 5px 0 0 0; font-size: 1.1rem; font-weight: 600;">Owner: Abdur Rasheed</p>
            <p style="color: #7f8c8d; margin: 2px 0; font-size: 1rem;">Rajar Thaht Bhai road Saro Shah Pull</p>
            <p style="color: #2c3e50; margin: 2px 0; font-size: 1.1rem; font-weight: 700;">
                <i class="fas fa-phone-alt" style="font-size: 0.9em; margin-right: 5px;"></i><img src="assets/easypaisa.svg" alt="Easypaisa" style="height: 1.2em; vertical-align: bottom; margin-right: 5px;"><span style="color: #4CAF50;">Easypaisa</span>: 0302-5739025
            </p>
        </div>
    `;
}


function showNotification(type, message) {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;

    const icon = type === 'success' ? 'fa-check-circle' :
        type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';

    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <div class="message">${message}</div>
    `;

    container.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Close modals when clicking outside
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

console.log('Renderer script loaded successfully');

// ═══════════════════════════════════════════════════════════
// NOTIFICATION & ADMIN SYSTEM
// ═══════════════════════════════════════════════════════════

// Store read/deleted notification IDs in memory (persisted in localStorage)
let readNotificationIds = new Set(JSON.parse(localStorage.getItem('readNotificationIds') || '[]'));
let deletedNotificationIds = new Set(JSON.parse(localStorage.getItem('deletedNotificationIds') || '[]'));

function saveNotificationState() {
    localStorage.setItem('readNotificationIds', JSON.stringify([...readNotificationIds]));
    localStorage.setItem('deletedNotificationIds', JSON.stringify([...deletedNotificationIds]));
}

async function loadAlerts() {
    try {
        const result = await window.api.getDashboardAlerts();
        if (result.success) {
            const alerts = result.alerts;
            updateNotificationUI(alerts);
        }
    } catch (error) {
        console.error('Error loading alerts:', error);
    }
}

function updateNotificationUI(alerts) {
    // Filter out deleted notifications completely
    const activeAlerts = alerts.filter(alert => !deletedNotificationIds.has(generateAlertId(alert)));

    // Filter out read notifications for the badge count
    const unreadAlerts = activeAlerts.filter(alert => !readNotificationIds.has(generateAlertId(alert)));

    // 1. Update Badge
    const badgeCount = document.getElementById('alert-count');
    if (badgeCount) {
        badgeCount.textContent = unreadAlerts.length;
        badgeCount.style.display = unreadAlerts.length > 0 ? 'flex' : 'none';

        // Animate badge if count changed
        if (unreadAlerts.length > 0) {
            badgeCount.classList.add('pulse');
            setTimeout(() => badgeCount.classList.remove('pulse'), 500);
        }
    }

    // 2. Toggle Actions State
    const actionsContainer = document.querySelector('.notification-actions');
    if (actionsContainer) {
        if (activeAlerts.length === 0) {
            actionsContainer.style.opacity = '0.3';
            actionsContainer.style.pointerEvents = 'none';
        } else {
            actionsContainer.style.opacity = '1';
            actionsContainer.style.pointerEvents = 'auto';
        }
    }

    // 3. Update Header Dropdown
    const list = document.getElementById('notification-list');
    if (list) {
        if (activeAlerts.length === 0) {
            list.innerHTML = `
                <div class="notification-empty">
                    <span>You're all caught up!<br>No new notifications.</span>
                </div>`;
        } else {
            list.innerHTML = activeAlerts.map(alert => {
                const alertId = generateAlertId(alert);
                const isRead = readNotificationIds.has(alertId);
                const severity = alert.severity || 'warning';

                return `
                <div class="notification-item ${isRead ? '' : 'unread'}" 
                     data-id="${alertId}"
                     data-severity="${severity}"
                     style="cursor: pointer;"
                     onclick="markNotificationAsRead('${alertId}', this); navigateFromAlert('${alert.type}', '${alert.target}')">
                    <div class="notification-icon">
                        <i class="fas fa-${severity === 'danger' ? 'circle-exclamation' : 'triangle-exclamation'}"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${alert.title}</div>
                        <div class="notification-message">${alert.message}</div>
                        <div class="notification-time">Just now</div>
                    </div>
                    <div class="notification-delete" 
                         onclick="deleteNotification('${alertId}', event)"
                         title="Dismiss">
                        <i class="fas fa-trash-alt"></i>
                    </div>
                </div>
            `}).join('');
        }
    }

    // 4. Update Dashboard Widget (if on dashboard)
    const dashboardAlertsContainer = document.getElementById('alerts-container');
    if (dashboardAlertsContainer) {
        if (activeAlerts.length == 0) {
            dashboardAlertsContainer.innerHTML = '<p class="text-muted">No active alerts</p>';
        } else {
            dashboardAlertsContainer.innerHTML = activeAlerts.map(alert => `
                <div class="alert alert-${alert.severity}" 
                     style="cursor: pointer; transition: transform 0.2s;" 
                     onclick="navigateFromAlert('${alert.type}', '${alert.target}')"
                     onmouseover="this.style.transform='translateX(5px)'"
                     onmouseout="this.style.transform='translateX(0)'">
                    <i class="fas fa-${alert.severity === 'danger' ? 'exclamation-circle' : 'exclamation-triangle'}"></i>
                    <div>
                        <strong>${alert.title}</strong><br>
                        ${alert.message}
                    </div>
                </div>
            `).join('');
        }
    }
}


window.navigateFromAlert = (type, target) => {
    if (!target) return;

    // Switch to the target tab
    const tabBtn = document.querySelector(`.nav-item[data-tab="${target}"]`);
    if (tabBtn) {
        tabBtn.click();

        // If it's an installment alert, apply the "Overdue" filter
        if (target === 'installments') {
            setTimeout(() => {
                const overdueBtn = document.querySelector('.installment-filter[data-status="Overdue"]');
                if (type === 'overdue' && overdueBtn) {
                    overdueBtn.click();
                } else if (type === 'due-today') {
                    // Just refresh installments for due today
                    const filterAll = document.querySelector('.installment-filter[data-status="All"]');
                    if (filterAll) filterAll.click();
                    else loadInstallments();
                }
            }, 100);
        } else if (target === 'inventory') {
            // If low stock, maybe also set the search or filter?
            // Currently just switching to the tab is enough
        }
    }

    // Close notification dropdown if open
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown) dropdown.classList.remove('active');
}

// Global functions for inline onclick handlers
window.markNotificationAsRead = (alertId, element) => {
    if (readNotificationIds.has(alertId)) return;

    readNotificationIds.add(alertId);
    saveNotificationState();

    // Update UI immediately without reload
    element.classList.remove('unread');

    // Update badge ID
    const badgeCount = document.getElementById('alert-count');
    if (badgeCount) {
        const currentCount = parseInt(badgeCount.textContent || '0');
        const newCount = Math.max(0, currentCount - 1);
        badgeCount.textContent = newCount;
        badgeCount.style.display = newCount > 0 ? 'flex' : 'none';
    }
};

window.deleteNotification = (alertId, event) => {
    event.stopPropagation(); // Prevent triggering markAsRead

    deletedNotificationIds.add(alertId);
    saveNotificationState();

    // Animate removal
    const item = event.target.closest('.notification-item');
    if (item) {
        item.classList.add('deleted');
        setTimeout(() => {
            // Reload alerts to refresh the list proper
            loadAlerts();
        }, 200);
    }
};

// Helper to generate a unique ID for an alert (since they might not have DB IDs)
function generateAlertId(alert) {
    // Generate a simple hash or use title+message. 
    // Ideally backend should provide stable IDs.
    // Replace spaces and special chars for HTML safe IDs
    return btoa(`${alert.title}-${alert.message}`).replace(/[^a-zA-Z0-9]/g, '');
}

// Notification Dropdown Toggle
const alertBadge = document.getElementById('alert-badge');
const notificationDropdown = document.getElementById('notification-dropdown');
const markAllReadBtn = document.getElementById('mark-all-read');
const clearAllBtn = document.getElementById('clear-all-notifications');

if (alertBadge && notificationDropdown) {
    alertBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationDropdown.classList.toggle('active');
        // Refresh alerts when opening
        if (notificationDropdown.classList.contains('active')) {
            loadAlerts();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.notifications-wrapper')) return;
        notificationDropdown.classList.remove('active');
    });
}

// Mark all as read
if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        try {
            const result = await window.api.getDashboardAlerts();
            if (result.success) {
                result.alerts.forEach(alert => {
                    const id = generateAlertId(alert);
                    if (!deletedNotificationIds.has(id)) {
                        readNotificationIds.add(id);
                    }
                });
                saveNotificationState();
                updateNotificationUI(result.alerts);
            }
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    });
}

// Clear all notifications
if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const notifications = []; // Assuming 'notifications' refers to active alerts
        if (notifications.length === 0) return;
        const isConfirmed = await appConfirm('Are you sure you want to clear all notifications?');
        if (!isConfirmed) return;

        try {
            const result = await window.api.getDashboardAlerts();
            if (result.success) {
                result.alerts.forEach(alert => {
                    deletedNotificationIds.add(generateAlertId(alert));
                });
                saveNotificationState();
                updateNotificationUI(result.alerts);
            }
        } catch (error) {
            console.error('Error clearing all notifications:', error);
        }
    });
}

// Admin Profile Button Logic is now handled by the navigation redirect above

// Change Password Form
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        showNotification('error', 'New passwords do not match');
        return;
    }

    if (newPassword.length < 4) {
        showNotification('error', 'Password must be at least 4 characters');
        return;
    }

    try {
        const result = await window.api.changePassword({
            username: currentUser.username,
            oldPassword: currentPassword,
            newPassword: newPassword
        });

        if (result.success) {
            showNotification('success', 'Password changed successfully');
            document.getElementById('change-password-form').reset();
        } else {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Error changing password: ' + error.message);
    }
});

// Password Visibility Toggle
document.querySelectorAll('.password-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        const targetId = toggle.dataset.target;
        const input = document.getElementById(targetId);
        const icon = toggle.querySelector('i');

        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    });
});

// Database Export
document.getElementById('export-db-btn').addEventListener('click', async () => {
    try {
        const result = await window.api.exportDatabase();
        if (result.success) {
            showNotification('success', result.message);
        } else if (result.message !== 'Export cancelled') {
            showNotification('error', result.message);
        }
    } catch (error) {
        showNotification('error', 'Export failed: ' + error.message);
    }
});

// Database Import
const importDbBtn = document.getElementById('import-db-btn');
if (importDbBtn) {
    importDbBtn.addEventListener('click', async () => {
        const isConfirmed = await appConfirm('WARNING: importing a database will OVERWRITE all current data. The application will restart after import. Are you sure you want to proceed?', 'DANGER: Overwrite Database?');
        if (isConfirmed) {
            try {
                const result = await window.api.importDatabase();
                if (result.success) {
                    showNotification('success', result.message);
                } else if (result.message !== 'Import cancelled') {
                    showNotification('error', result.message);
                }
            } catch (error) {
                showNotification('error', 'Import failed: ' + error.message);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════
// PROFILE MANAGEMENT
// ═══════════════════════════════════════════════════════════

// Profile Image Preview
const profileImageUpload = document.getElementById('profile-image-upload');
const settingsProfileImage = document.getElementById('settings-profile-image');
let selectedProfileImage = null;

if (profileImageUpload) {
    profileImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                showNotification('error', 'Please select an image file');
                return;
            }

            // Preview
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Str = e.target.result;
                settingsProfileImage.src = base64Str;
                selectedProfileImage = base64Str; // Pass base64 to IPC
            };
            reader.readAsDataURL(file);
        }
    });
}

// Update Profile Form
const updateProfileForm = document.getElementById('update-profile-form');
if (updateProfileForm) {
    updateProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newUsername = document.getElementById('profile-username').value;

        try {
            const result = await window.api.updateProfile({
                username: currentUser.username,
                newUsername: newUsername,
                imagePath: selectedProfileImage
            });

            if (result.success) {
                showNotification('success', result.message);

                // Update local state and UI
                currentUser.username = result.user.username;
                if (result.user.profile_image) {
                    currentUser.profile_image = result.user.profile_image;
                }

                updateUserUI();
            } else {
                showNotification('error', result.message);
            }
        } catch (error) {
            showNotification('error', 'Update failed: ' + error.message);
        }
    });
}

function updateUserUI() {
    if (currentUser) {
        document.getElementById('current-user').textContent = currentUser.username;
        const profileUsernameInput = document.getElementById('profile-username');
        if (profileUsernameInput) profileUsernameInput.value = currentUser.username;

        let imageUrl = currentUser.profile_image;

        // Update header avatar
        const headerUserInfo = document.querySelector('.user-info');
        if (headerUserInfo) {
            const existingIcon = headerUserInfo.querySelector('i.fa-user-circle');
            const existingImg = headerUserInfo.querySelector('img');

            if (imageUrl) {
                if (existingIcon) {
                    const img = document.createElement('img');
                    img.src = imageUrl;
                    img.style.width = '32px';
                    img.style.height = '32px';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.style.marginRight = '8px';
                    // We need to keep the original icon's behavior if it had classes or styling, 
                    // but the existing code just replaces it.
                    existingIcon.replaceWith(img);
                } else if (existingImg) {
                    existingImg.src = imageUrl;
                }
            }
        }

        // Update settings image
        if (imageUrl && settingsProfileImage) {
            settingsProfileImage.src = imageUrl;
        }
    }
}

// ═══════════════════════════════════════════════════════════
// PASSWORD RECOVERY
// ═══════════════════════════════════════════════════════════

// Forgot Password Link
const forgotPasswordLink = document.getElementById('forgot-password-link');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('recovery-modal');
    });
}

// Recovery Form
const recoveryForm = document.getElementById('recovery-form');
if (recoveryForm) {
    recoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const code = document.getElementById('recovery-code').value;
        const newPassword = document.getElementById('recovery-new-password').value;
        const confirmPassword = document.getElementById('recovery-confirm-password').value;

        if (newPassword !== confirmPassword) {
            showNotification('error', 'Passwords do not match');
            return;
        }

        try {
            const result = await window.api.recoverPassword({ code, newPassword });
            if (result.success) {
                showNotification('success', result.message);
                closeModal('recovery-modal');
                // clear form
                recoveryForm.reset();
            } else {
                showNotification('error', result.message);
            }
        } catch (error) {
            showNotification('error', 'Recovery failed: ' + error.message);
        }
    });
}

// Update Recovery Code Form
const updateRecoveryCodeForm = document.getElementById('update-recovery-code-form');
if (updateRecoveryCodeForm) {
    updateRecoveryCodeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const currentPassword = document.getElementById('recovery-current-password').value;
        const newCode = document.getElementById('new-recovery-code').value;

        try {
            const result = await window.api.updateRecoveryCode({
                username: currentUser.username,
                currentPassword,
                newCode
            });

            if (result.success) {
                showNotification('success', result.message);
                updateRecoveryCodeForm.reset();
            } else {
                showNotification('error', result.message);
            }
        } catch (error) {
            showNotification('error', 'Update failed: ' + error.message);
        }
    });
}

// Global Enter Key Prevention for Input Fields
// Prevents modals and forms from unintentionally submitting/refreshing when hitting Enter
document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        const target = event.target;
        // Allow Enter on Textareas, Submit Buttons, specially handled inputs, and the login form
        if (target.tagName !== 'TEXTAREA' &&
            target.type !== 'submit' &&
            target.type !== 'button' &&
            !target.closest('#login-form') &&
            !target.closest('.custom-dropdown-input-area') &&
            !target.closest('.custom-dropdown-select') &&
            !target.classList.contains('custom-dropdown-item-edit-input')) {
            event.preventDefault();
        }
    }
});

// Custom Asynchronous Confirm Dialog
function appConfirm(message, title = 'Are you sure?') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const messageEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;

        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);

        modal.classList.add('active');
    });
}

