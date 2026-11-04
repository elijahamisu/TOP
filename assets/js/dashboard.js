/**
 * TOP - Dashboard Module
 * Manages real-time data synchronization, financial summaries, 
 * investment tracking, and dashboard analytics.
 */

import { ENV, formatCurrency, formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader, copyToClipboard } from './app.js';
import { getUserDashboardData, getUserWalletStats } from '../api/users.js';
import { getUserNotifications, markAsRead } from '../api/notifications.js';

// --- Dashboard State ---
let currentUser = null;
let realtimeSubs = [];

/**
 * --- INITIALIZATION ---
 */
const initDashboard = async () => {
    // 1. Protect Route
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Synchronizing your account...");

    try {
        // 2. Initial Data Load
        await refreshDashboardData();

        // 3. Start Real-time Listeners
        setupDashboardRealtime();

        // 4. Initialize UI Components (Timers, Charts)
        startEarningsTimer();
        
    } catch (err) {
        console.error("Dashboard Init Error:", err);
        notify("Failed to load some dashboard components. Please refresh.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */
const refreshDashboardData = async () => {
    const response = await getUserDashboardData();
    
    if (response.success) {
        const { profile, wallet, recentTransactions } = response.data;
        
        // Update Profile UI
        updateProfileUI(profile);
        
        // Update Wallet UI
        updateWalletUI(wallet);
        
        // Update Transactions UI
        updateTransactionsUI(recentTransactions);
        
        // Load additional specific sections
        await Promise.all([
            loadInvestmentsSummary(),
            loadNotificationSummary(),
            renderDashboardCharts()
        ]);
    }
};

/**
 * --- UI UPDATERS ---
 */

const updateProfileUI = (profile) => {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    const refCodeEl = document.getElementById('refCodeText');

    if (nameEl) nameEl.innerText = profile.full_name;
    if (avatarEl) avatarEl.innerText = profile.full_name.charAt(0).toUpperCase();
    if (refCodeEl) {
        refCodeEl.innerText = profile.username.toUpperCase();
        window.userRefLink = `${window.location.origin}/register.html?ref=${profile.username}`;
    }
};

const updateWalletUI = (wallet) => {
    const balEl = document.getElementById('walletBalance');
    const availEl = document.getElementById('availBalance');
    const earnEl = document.getElementById('totalEarnings');

    if (balEl) balEl.innerText = formatCurrency(wallet.balance);
    if (availEl) availEl.innerText = formatCurrency(wallet.balance);
    if (earnEl) earnEl.innerText = formatCurrency(wallet.totalEarnings || 0);
};

const updateTransactionsUI = (transactions) => {
    const container = document.getElementById('transactionList');
    if (!container) return;

    if (transactions.length === 0) {
        container.innerHTML = `<p class="empty-state">No recent activity.</p>`;
        return;
    }

    container.innerHTML = transactions.map(tx => {
        const isPositive = ['deposit', 'earning', 'bonus', 'referral'].includes(tx.type);
        return `
            <div class="investment-card">
                <div class="inv-info">
                    <h4>${tx.description || tx.type.toUpperCase()}</h4>
                    <p>${formatDateTime(tx.created_at)}</p>
                </div>
                <div style="font-weight:700; color: ${isPositive ? 'var(--success)' : 'var(--danger)'}">
                    ${isPositive ? '+' : '-'}${formatCurrency(tx.amount)}
                </div>
            </div>
        `;
    }).join('');
};

const loadInvestmentsSummary = async () => {
    const container = document.getElementById('investmentList');
    if (!container) return;

    const { data: investments } = await supabase
        .from('investments')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (!investments || investments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-rocket" style="opacity:0.2; font-size:30px; margin-bottom:10px;"></i>
                <p>No active investments. Start earning today!</p>
                <a href="plans.html" class="view-all" style="margin-top:10px; display:inline-block;">Browse Plans</a>
            </div>`;
        document.getElementById('activeInvestments').innerText = '0';
        return;
    }

    document.getElementById('activeInvestments').innerText = investments.length;

    container.innerHTML = investments.map(inv => `
        <div class="investment-card">
            <div class="inv-info">
                <h4>${inv.plan_name}</h4>
                <p>Maturity: ${new Date(inv.end_date).toLocaleDateString()}</p>
            </div>
            <div class="inv-badge">ACTIVE</div>
        </div>
    `).join('');
};

const loadNotificationSummary = async () => {
    const res = await getUserNotifications({ unreadOnly: true });
    const dot = document.getElementById('notifDot');
    if (dot && res.success) {
        dot.style.display = res.data.length > 0 ? 'block' : 'none';
    }
};

/**
 * --- REAL-TIME LISTENERS ---
 */
const setupDashboardRealtime = () => {
    // 1. Watch Wallet Balance
    realtimeSubs.push(
        subscribeToTable('dashboard-wallet', 'wallets', 'UPDATE', (payload) => {
            if (payload.new.user_id === currentUser.id) {
                updateWalletUI({ balance: payload.new.balance });
            }
        })
    );

    // 2. Watch New Transactions
    realtimeSubs.push(
        subscribeToTable('dashboard-tx', 'transactions', 'INSERT', (payload) => {
            if (payload.new.user_id === currentUser.id) {
                refreshDashboardData(); // Full refresh for consistency
                notify("Transaction Updated", "success");
            }
        })
    );

    // 3. Watch Notifications
    realtimeSubs.push(
        subscribeToTable('dashboard-notifs', 'notifications', 'INSERT', (payload) => {
            if (payload.new.user_id === currentUser.id) {
                loadNotificationSummary();
            }
        })
    );
};

/**
 * --- UTILITIES & ANALYTICS ---
 */

const startEarningsTimer = () => {
    const timerEl = document.getElementById('nextEarningsTimer'); // If exists in UI
    if (!timerEl) return;

    setInterval(() => {
        const now = new Date();
        const next = new Date();
        next.setHours(24, 0, 0, 0); // Midnight Lagos
        const diff = next - now;
        
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        
        timerEl.innerText = `${h}h ${m}m ${s}s`;
    }, 1000);
};

const renderDashboardCharts = async () => {
    const chartCanvas = document.getElementById('earningsChart');
    if (!chartCanvas) return;

    // Simple Earnings Visualization logic
    // In a full implementation, we'd fetch daily totals from 'transactions' type='earning'
    console.log("Dashboard: Charting components initialized.");
};

// Global Copy Reference for the "Copy Code" button
window.copyRef = () => {
    const code = document.getElementById('refCodeText').innerText;
    copyToClipboard(code);
};

// Global Share Logic
window.shareRef = () => {
    if (navigator.share) {
        navigator.share({
            title: `Join ${ENV.APP_NAME}`,
            text: `Invest and earn daily Naira profits. Use my code!`,
            url: window.userRefLink
        }).catch(console.error);
    } else {
        copyToClipboard(window.userRefLink);
    }
};

// Init on load
document.addEventListener('DOMContentLoaded', initDashboard);

export { refreshDashboardData };
