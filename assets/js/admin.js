/**
 * TOP - Administrator Module
 * Handles high-privilege operations, financial approvals, platform analytics,
 * real-time monitoring, and system-wide settings management.
 */

import { ENV, formatCurrency, formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectAdminPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { getAdminStats, adminGetUsers, adminSetUserStatus } from '../api/users.js';
import { adminApproveDeposit, adminRejectDeposit } from '../api/deposits.js';
import { adminApproveWithdrawal, adminRejectWithdrawal } from '../api/withdrawals.js';
import { adminUpdateInvestmentStatus } from '../api/investments.js';
import { updatePlatformSettings, getPlatformSettings } from '../api/settings.js';

// --- Admin State ---
let currentAdmin = null;
let platformData = {
    users: [],
    deposits: [],
    withdrawals: [],
    investments: []
};

/**
 * --- INITIALIZATION & AUTH GUARD ---
 */
const initAdminModule = async () => {
    // 1. Strict Administrator Route Protection
    currentAdmin = await protectAdminPage();
    if (!currentAdmin) return;

    toggleLoader(true, "Synchronizing Admin Console...");

    try {
        // 2. Identify Page Context and Load Relevant Data
        const path = window.location.pathname;

        if (path.includes('admin/index.html') || path.endsWith('/admin/')) {
            await refreshAdminDashboard();
        } else if (path.includes('admin/users.html')) {
            await loadUserManagement();
        } else if (path.includes('admin/deposits.html')) {
            await loadDepositRequests();
        } else if (path.includes('admin/withdrawals.html')) {
            await loadWithdrawalRequests();
        } else if (path.includes('admin/settings.html')) {
            await loadPlatformSettings();
        }

        // 3. Global Admin Real-time Sync
        setupAdminRealtime();

    } catch (err) {
        console.error("Admin Module Error:", err);
        notify("Failed to load management data.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DASHBOARD & ANALYTICS ---
 */
const refreshAdminDashboard = async () => {
    const { data: stats, success } = await getAdminStats();
    if (!success) return;

    // Update Dashboard Counters
    const mapping = {
        'countUsers': stats.totalUsers,
        'countDeposits': formatCurrency(stats.totalDepositValue),
        'countInvestments': stats.activeInvestments,
        'countEarnings': formatCurrency(stats.totalEarningsPaid || 0)
    };

    for (const [id, val] of Object.entries(mapping)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    await loadRecentActivities();
};

const loadRecentActivities = async () => {
    // Fetch latest 5 requests for the dashboard "Pending Approvals" table
    const { data: pending } = await supabase
        .from('deposits')
        .select('*, profiles(full_name)')
        .eq('status', 'pending')
        .limit(5);

    const container = document.getElementById('pendingTableBody');
    if (container && pending) {
        container.innerHTML = pending.map(item => `
            <tr>
                <td>${item.profiles.full_name}</td>
                <td><b>${formatCurrency(item.amount)}</b></td>
                <td>Deposit</td>
                <td>${formatDateTime(item.created_at)}</td>
                <td><span class="status-pill pill-pending">Pending</span></td>
                <td><button class="action-btn" onclick="location.href='deposits.html'">Review</button></td>
            </tr>
        `).join('');
    }
};

/**
 * --- FINANCIAL APPROVAL LOGIC ---
 */

/**
 * Approve a User Deposit
 * Triggers wallet credit and notification via API.
 */
window.handleApproveDeposit = async (id) => {
    if (!confirm("Verify and credit this deposit to user wallet?")) return;
    
    toggleLoader(true, "Updating User Wallet...");
    const res = await adminApproveDeposit(id);
    
    if (res.success) {
        notify("Deposit approved and funds credited.", "success");
        await logAdminAction(`Approved Deposit #${id}`, id);
    } else {
        notify(res.error, "error");
    }
    toggleLoader(false);
};

/**
 * Reject a User Deposit
 * Requires a reason and notifies user.
 */
window.handleRejectDeposit = async (id) => {
    const reason = prompt("Enter rejection reason:");
    if (!reason) return;

    toggleLoader(true, "Processing Rejection...");
    const res = await adminRejectDeposit(id, reason);
    
    if (res.success) {
        notify("Deposit request rejected.", "info");
        await logAdminAction(`Rejected Deposit #${id}. Reason: ${reason}`, id);
    }
    toggleLoader(false);
};

/**
 * --- USER MANAGEMENT ---
 */
const loadUserManagement = async () => {
    const res = await adminGetUsers();
    if (res.success) {
        platformData.users = res.data;
        renderAdminUserTable();
    }
};

window.handleUserStatus = async (userId, currentStatus) => {
    const newStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
    if (!confirm(`Are you sure you want to ${newStatus} this user?`)) return;

    const res = await adminSetUserStatus(userId, newStatus);
    if (res.success) {
        notify(`User account ${newStatus}.`, "success");
        await loadUserManagement();
        await logAdminAction(`${newStatus.toUpperCase()} user account`, userId);
    }
};

/**
 * --- SETTINGS MANAGEMENT ---
 */
const loadPlatformSettings = async () => {
    const res = await getPlatformSettings();
    if (res.success) {
        const form = document.getElementById('settingsForm');
        if (!form) return;

        // Auto-fill form fields based on DB keys
        Object.keys(res.data).forEach(key => {
            const input = form.elements[key];
            if (input) {
                if (input.type === 'checkbox') input.checked = res.data[key];
                else input.value = res.data[key];
            }
        });
    }
};

window.saveAllSettings = async () => {
    const form = document.getElementById('settingsForm');
    const formData = new FormData(form);
    const updates = {};
    
    formData.forEach((val, key) => updates[key] = val);
    // Handle checkboxes
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => updates[cb.name] = cb.checked);

    toggleLoader(true, "Saving configurations...");
    const res = await updatePlatformSettings(updates);
    
    if (res.success) {
        notify("Platform settings updated successfully.", "success");
        await logAdminAction("Updated Global Platform Settings");
    } else {
        notify(res.error, "error");
    }
    toggleLoader(false);
};

/**
 * --- AUDIT LOGGING HELPER ---
 */
const logAdminAction = async (action, targetId = null) => {
    try {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', currentAdmin.id).single();
        
        await supabase.from('admin_logs').insert([{
            admin_id: currentAdmin.id,
            action: action,
            target_id: targetId,
            admin_name: profile.full_name,
            device_info: navigator.userAgent,
            created_at: new Date().toISOString()
        }]);
    } catch (err) {
        console.warn("Audit Log Failed:", err);
    }
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupAdminRealtime = () => {
    // Monitor all platform tables for changes and update dashboard UI
    const channel = supabase.channel('admin-global-sync')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
            console.log("Admin: Real-time update detected.", payload.table);
            // Refresh stats if on dashboard
            if (window.location.pathname.includes('admin/index.html')) {
                refreshAdminDashboard();
            }
        })
        .subscribe();
};

/**
 * --- EXPORT UTILITIES ---
 */
window.exportTableToCSV = (filename) => {
    const rows = document.querySelectorAll("table tr");
    let csv = [];
    for (const row of rows) {
        const cols = row.querySelectorAll("td, th");
        const rowData = [];
        for (const col of cols) rowData.push(`"${col.innerText}"`);
        csv.push(rowData.join(","));
    }
    const csvFile = new Blob([csv.join("\n")], { type: "text/csv" });
    const downloadLink = document.createElement("a");
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.click();
};

// Initial Load
document.addEventListener('DOMContentLoaded', initAdminModule);

export { logAdminAction, refreshAdminDashboard };
