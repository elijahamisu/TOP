/**
 * TOP - Wallet Module
 * Manages real-time balances, financial aggregations, and transaction filtering.
 */

import { formatCurrency, formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { getUserWalletStats } from '../api/users.js';

// --- Wallet State ---
let currentUser = null;
let walletData = {
    balance: 0,
    transactions: [],
    filters: {
        type: 'all',
        search: ''
    }
};

/**
 * --- INITIALIZATION ---
 */
const initWallet = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Updating your wallet...");

    try {
        // 2. Initial Data Fetch
        await refreshWalletStats();
        await loadFullActivity();

        // 3. Setup Real-time Sync
        setupWalletRealtime();

        // 4. Bind UI Event Listeners
        setupEventListeners();

    } catch (err) {
        console.error("Wallet Init Error:", err);
        notify("Unable to sync wallet data. Please check your connection.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */

/**
 * Fetches balances and financial summaries from the Users API.
 */
const refreshWalletStats = async () => {
    const res = await getUserWalletStats(currentUser.id);
    if (res.success) {
        walletData.balance = res.data.balance;
        renderBalanceUI(res.data);
    }
};

/**
 * Loads the complete transaction history for the Activity section.
 */
const loadFullActivity = async () => {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (!error) {
        walletData.transactions = data;
        renderActivityList();
    }
};

/**
 * --- UI RENDERING ---
 */

const renderBalanceUI = (stats) => {
    // Update main balances
    const mainBal = document.getElementById('mainBalance');
    const totInv = document.getElementById('totalInvested');
    const totEar = document.getElementById('totalEarnings');
    const totDep = document.getElementById('totalDeposits');
    const totWit = document.getElementById('totalWithdrawals');
    const totRef = document.getElementById('totalReferral');
    const totGif = document.getElementById('totalGift');

    if (mainBal) mainBal.innerText = formatCurrency(stats.balance);
    if (totInv) totInv.innerText = formatCurrency(stats.activeInvestments || 0);
    if (totEar) totEar.innerText = formatCurrency(stats.totalEarnings || 0);
    if (totDep) totDep.innerText = formatCurrency(stats.totalDeposits || 0);
    if (totWit) totWit.innerText = formatCurrency(stats.totalWithdrawals || 0);
    if (totRef) totRef.innerText = formatCurrency(stats.totalReferralRewards || 0);
    if (totGif) totGif.innerText = formatCurrency(stats.totalGiftRewards || 0);
};

const renderActivityList = () => {
    const container = document.getElementById('txList');
    if (!container) return;

    const filtered = walletData.transactions.filter(tx => {
        const matchesType = walletData.filters.type === 'all' || 
                            (walletData.filters.type === 'bonus' ? (tx.type === 'bonus' || tx.type === 'gift') : tx.type === walletData.filters.type);
        const matchesSearch = tx.id.includes(walletData.filters.search) || 
                              (tx.description && tx.description.toLowerCase().includes(walletData.filters.search.toLowerCase()));
        return matchesType && matchesSearch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-receipt"></i>
                <p>No transactions found.</p>
                <a href="deposit.html" class="filter-btn active" style="text-decoration:none; margin-top:10px; display:inline-block;">Deposit Now</a>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(tx => {
        const isPositive = ['deposit', 'earning', 'referral', 'gift', 'bonus'].includes(tx.type);
        return `
            <div class="tx-item">
                <div class="tx-info">
                    <h5 style="text-transform: capitalize;">${tx.description || tx.type}</h5>
                    <p>${formatDateTime(tx.created_at)}</p>
                </div>
                <div class="tx-amount">
                    <h4 style="color: ${isPositive ? 'var(--success)' : 'var(--danger)'}">
                        ${isPositive ? '+' : '-'}${formatCurrency(tx.amount)}
                    </h4>
                    <p style="color: var(--text-muted)">SUCCESS</p>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * --- EVENT LISTENERS ---
 */
const setupEventListeners = () => {
    // Search Input
    const searchInput = document.getElementById('txSearch'); // Add this ID to your HTML search box if missing
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            walletData.filters.search = e.target.value;
            renderActivityList();
        });
    }

    // Filter Buttons (using global function defined in HTML but managed here)
    window.filterTransactions = (type, btn) => {
        walletData.filters.type = type;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderActivityList();
    };
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupWalletRealtime = () => {
    // Listen for balance updates
    subscribeToTable('wallet-balance-sync', 'wallets', 'UPDATE', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            refreshWalletStats();
            notify("Wallet balance updated.", "success");
        }
    });

    // Listen for new transactions
    subscribeToTable('wallet-activity-sync', 'transactions', 'INSERT', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            loadFullActivity();
            refreshWalletStats();
        }
    });
};

// Initial Load
document.addEventListener('DOMContentLoaded', initWallet);

export { refreshWalletStats, loadFullActivity };
