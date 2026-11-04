/**
 * TOP - Deposit Module
 * Manages Kuda Bank deposit requests, dynamic bank info retrieval,
 * real-time status tracking, and deposit history management.
 */

import { ENV, formatCurrency } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader, copyToClipboard } from './app.js';
import { getKudaBankDetails, createDepositRequest } from '../api/deposits.js';
import { getUserWalletStats } from '../api/users.js';

// --- Module State ---
let currentUser = null;
let depositHistory = [];
let filters = { search: '', status: 'all' };

/**
 * --- INITIALIZATION ---
 */
const initDepositModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Initializing secure deposit...");

    try {
        // 2. Load Dynamic Data
        await Promise.all([
            loadBankInformation(),
            loadWalletBalance(),
            refreshDepositHistory()
        ]);

        // 3. Setup Real-time Sync
        setupDepositRealtime();

        // 4. Setup Local UI Listeners
        setupUIEvents();

    } catch (err) {
        console.error("Deposit Init Error:", err);
        notify("Failed to load deposit settings. Please refresh.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */

/**
 * Fetches Kuda Bank details from Platform Settings in Supabase.
 */
const loadBankInformation = async () => {
    const res = await getKudaBankDetails();
    if (res.success) {
        const { kuda_account_name, kuda_account_number, kuda_bank_name, deposit_instructions } = res.data;
        
        // Update UI placeholders
        const nameEl = document.getElementById('kudaName');
        const numEl = document.getElementById('kudaNumber');
        const bankEl = document.getElementById('kudaBank');
        const instEl = document.getElementById('depositInstructions');

        if (nameEl) nameEl.innerText = kuda_account_name;
        if (numEl) numEl.innerText = kuda_account_number;
        if (bankEl) bankEl.innerText = kuda_bank_name;
        if (instEl) instEl.innerText = deposit_instructions;

        // Store globally for quick copying
        window.activeKudaNumber = kuda_account_number;
    }
};

const loadWalletBalance = async () => {
    const res = await getUserWalletStats(currentUser.id);
    if (res.success) {
        const balEl = document.getElementById('walletBal');
        if (balEl) balEl.innerText = formatCurrency(res.data.balance);
    }
};

const refreshDepositHistory = async () => {
    const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (!error) {
        depositHistory = data;
        renderHistoryList();
    }
};

/**
 * --- DEPOSIT ACTIONS ---
 */

/**
 * Submits a new deposit request to the administrator.
 */
window.submitDeposit = async () => {
    const amountInput = document.getElementById('depositAmount');
    const amount = parseFloat(amountInput?.value);

    // Basic Validation
    if (!amount || amount <= 0) {
        notify("Please enter a valid deposit amount.", "warning");
        return;
    }

    if (amount < 1000) {
        notify("Minimum deposit is ₦1,000.", "warning");
        return;
    }

    toggleLoader(true, "Submitting deposit request...");

    const res = await createDepositRequest(amount);

    if (res.success) {
        notify("Request submitted! Your wallet will update once verified.", "success");
        if (amountInput) amountInput.value = '';
        await refreshDepositHistory();
    } else {
        notify(res.error || "Failed to submit request.", "error");
    }
    
    toggleLoader(false);
};

/**
 * --- UI RENDERING & FILTERING ---
 */

const renderHistoryList = () => {
    const container = document.getElementById('depositList');
    if (!container) return;

    const filtered = depositHistory.filter(d => {
        const matchesSearch = d.id.includes(filters.search);
        const matchesStatus = filters.status === 'all' || d.status === filters.status;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<p class="empty-state">No deposit records found.</p>`;
        return;
    }

    container.innerHTML = filtered.map(d => {
        const date = new Date(d.created_at);
        return `
            <div class="history-item">
                <div class="hist-info">
                    <h5>${formatCurrency(d.amount)}</h5>
                    <p>${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div class="hist-status">
                    <span class="badge ${d.status}">${d.status.toUpperCase()}</span>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupDepositRealtime = () => {
    // Watch for status changes (Approval/Rejection by Admin)
    subscribeToTable('deposit-status-sync', 'deposits', 'UPDATE', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            refreshDepositHistory();
            loadWalletBalance();
            
            if (payload.new.status === 'approved') {
                notify(`Deposit of ${formatCurrency(payload.new.amount)} Approved!`, "success");
            } else if (payload.new.status === 'rejected') {
                notify("Your deposit request was rejected. Check notifications for details.", "error");
            }
        }
    });
};

/**
 * --- EVENT BINDING & UTILITIES ---
 */
const setupUIEvents = () => {
    // Search Listener
    document.getElementById('depSearch')?.addEventListener('input', (e) => {
        filters.search = e.target.value;
        renderHistoryList();
    });

    // Status Filter (Triggered by HTML Select)
    const filterEl = document.getElementById('statusFilter');
    if (filterEl) {
        filterEl.addEventListener('change', (e) => {
            filters.status = e.target.value;
            renderHistoryList();
        });
    }
};

// Global Copy Helper for Kuda Account
window.copyNumber = () => {
    if (window.activeKudaNumber) {
        copyToClipboard(window.activeKudaNumber);
    } else {
        notify("Account details not loaded yet.", "warning");
    }
};

// Start logic on load
document.addEventListener('DOMContentLoaded', initDepositModule);

export { refreshDepositHistory };
