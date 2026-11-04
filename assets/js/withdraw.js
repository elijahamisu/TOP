/**
 * TOP - Withdrawal Module
 * Manages withdrawal requests, Kuda Bank profile validation,
 * real-time status tracking, and automated balance restoration.
 */

import { formatCurrency, formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { createWithdrawalRequest, getWithdrawalStats } from '../api/withdrawals.js';
import { getUserWalletStats, getCurrentProfile } from '../api/users.js';

// --- Module State ---
let currentUser = null;
let currentWalletBalance = 0;
let withdrawalHistory = [];
let userBankDetails = null;
let filters = { search: '', status: 'all' };

/**
 * --- INITIALIZATION ---
 */
const initWithdrawalModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Synchronizing withdrawal vault...");

    try {
        // 2. Load Core Data
        await Promise.all([
            loadUserFinancials(),
            loadKudaBankProfile(),
            refreshWithdrawalHistory()
        ]);

        // 3. Setup Real-time Sync
        setupWithdrawalRealtime();

        // 4. Bind UI Listeners
        setupUIEvents();

    } catch (err) {
        console.error("Withdrawal Init Error:", err);
        notify("Failed to sync withdrawal data. Please refresh.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */

/**
 * Loads current wallet balance and withdrawal statistics.
 */
const loadUserFinancials = async () => {
    const res = await getUserWalletStats(currentUser.id);
    if (res.success) {
        currentWalletBalance = res.data.balance;
        
        // Update UI
        const balEl = document.getElementById('availableBal');
        const drawText = document.getElementById('withdrawableText');
        if (balEl) balEl.innerText = formatCurrency(currentWalletBalance);
        if (drawText) drawText.innerText = formatCurrency(currentWalletBalance);
    }

    const statsRes = await getWithdrawalStats(currentUser.id);
    if (statsRes.success) {
        const totalWit = document.getElementById('totalWithdrawn');
        const pendWit = document.getElementById('pendingBal');
        if (totalWit) totalWit.innerText = formatCurrency(statsRes.data.totalValue);
        if (pendWit) pendWit.innerText = PendCountToCurrency(statsRes.data.pendingCount); // Custom display helper
    }
};

/**
 * Verifies if user has configured their Kuda Bank account in their profile.
 */
const loadKudaBankProfile = async () => {
    const res = await getCurrentProfile();
    if (res.success) {
        // Assuming profile has bank_name, account_number, account_name fields
        const { bank_name, account_number, account_name } = res.data;
        
        if (bank_name && account_number && account_name) {
            userBankDetails = { bankName: bank_name, accountName: account_name, accountNumber: account_number };
            renderBankUI(userBankDetails);
        } else {
            notify("Please complete your bank profile to enable withdrawals.", "warning");
            renderMissingBankUI();
        }
    }
};

const refreshWithdrawalHistory = async () => {
    const { data, error } = await supabase
        .from('withdrawals')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (!error) {
        withdrawalHistory = data;
        renderHistoryList();
    }
};

/**
 * --- WITHDRAWAL ACTIONS ---
 */

/**
 * Submits a new withdrawal request.
 * Enforces ₦1,000 minimum and available balance check.
 */
window.submitWithdrawal = async () => {
    const amountInput = document.getElementById('withdrawAmount');
    const amount = parseFloat(amountInput?.value);

    // 1. Validations
    if (!userBankDetails) {
        notify("Add your Kuda Bank details in profile settings first.", "error");
        return;
    }

    if (!amount || amount < 1000) {
        notify("Minimum withdrawal amount is ₦1,000.", "warning");
        return;
    }

    if (amount > currentWalletBalance) {
        notify("Insufficient wallet balance.", "error");
        return;
    }

    // Check for existing pending request
    const hasPending = withdrawalHistory.some(w => w.status === 'pending');
    if (hasPending) {
        notify("You already have a pending withdrawal request.", "warning");
        return;
    }

    toggleLoader(true, "Processing withdrawal request...");

    // 2. Execute Request via API
    const res = await createWithdrawalRequest(amount, userBankDetails);

    if (res.success) {
        notify("Request submitted! Funds are reserved for processing.", "success");
        if (amountInput) amountInput.value = '';
        await refreshWithdrawalHistory();
        await loadUserFinancials(); // Update balance as it is now reserved
    } else {
        notify(res.error || "Failed to process withdrawal.", "error");
    }

    toggleLoader(false);
};

/**
 * --- UI RENDERING ---
 */

const renderBankUI = (bank) => {
    const container = document.getElementById('bankDisplayArea'); // If using a specific display box
    if (container) {
        container.innerHTML = `
            <p style="font-size:12px; color:var(--text-muted);">Payout Account:</p>
            <h5 style="margin-top:5px;">${bank.bankName} - ${bank.accountNumber}</h5>
            <p style="font-size:11px; color:var(--accent-color);">${bank.accountName}</p>
        `;
    }
};

const renderMissingBankUI = () => {
    const container = document.getElementById('bankDisplayArea');
    if (container) {
        container.innerHTML = `<p style="color:var(--danger); font-size:13px;">No registered bank account found. <a href="profile.html" style="color:white; font-weight:700;">Set it up here</a></p>`;
    }
};

const renderHistoryList = () => {
    const container = document.getElementById('withdrawList');
    if (!container) return;

    const filtered = withdrawalHistory.filter(w => {
        const matchesSearch = w.id.includes(filters.search) || w.bank_name.toLowerCase().includes(filters.search.toLowerCase());
        const matchesStatus = filters.status === 'all' || w.status === filters.status;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<p class="empty-state">No withdrawal records found.</p>`;
        return;
    }

    container.innerHTML = filtered.map(w => {
        return `
            <div class="history-item">
                <div class="hist-info">
                    <h5>${formatCurrency(w.amount)}</h5>
                    <p>${formatDateTime(w.created_at)} • ${w.bank_name}</p>
                    ${w.rejection_reason ? `<p style="color:var(--danger); font-size:10px; margin-top:5px;">Note: ${w.rejection_reason}</p>` : ''}
                </div>
                <div class="hist-status">
                    <span class="badge ${w.status}">${w.status.toUpperCase()}</span>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupWithdrawalRealtime = () => {
    // Watch for Status Updates (Approved/Rejected)
    subscribeToTable('withdrawal-status-sync', 'withdrawals', 'UPDATE', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            refreshWithdrawalHistory();
            loadUserFinancials();
            
            if (payload.new.status === 'approved') {
                notify(`Withdrawal of ${formatCurrency(payload.new.amount)} Approved & Paid!`, "success");
            } else if (payload.new.status === 'rejected') {
                notify("Withdrawal rejected. Funds restored to wallet.", "warning");
            }
        }
    });

    // Watch for Wallet changes directly
    subscribeToTable('withdrawal-wallet-sync', 'wallets', 'UPDATE', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            currentWalletBalance = payload.new.balance;
            const balEl = document.getElementById('availableBal');
            if (balEl) balEl.innerText = formatCurrency(currentWalletBalance);
        }
    });
};

/**
 * --- EVENT LISTENERS ---
 */
const setupUIEvents = () => {
    // Search Listener
    document.getElementById('witSearch')?.addEventListener('input', (e) => {
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

/**
 * --- UTILITY ---
 */
const PendCountToCurrency = (count) => {
    // This assumes the API provides count, but usually we need total value.
    // For now we calculate it from local history state.
    const val = withdrawalHistory
        .filter(w => w.status === 'pending')
        .reduce((s, w) => s + parseFloat(w.amount), 0);
    return formatCurrency(val);
};

// Initial Load
document.addEventListener('DOMContentLoaded', initWithdrawalModule);

export { refreshWithdrawalHistory };
