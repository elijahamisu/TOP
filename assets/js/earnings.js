/**
 * TOP - Earnings Module
 * Handles daily profit tracking, performance analytics,
 * and the automated 12:00 AM (Lagos) countdown and refresh logic.
 */

import { ENV, formatCurrency, formatDateTime, getLagosTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { getUserEarningsHistory, getEarningsStats } from '../api/earnings.js';
import { getUserWalletStats } from '../api/users.js';

// --- Module State ---
let currentUser = null;
let earningsHistory = [];
let chartInstance = null;
let countdownInterval = null;
let filters = { search: '', status: 'all', period: 'all' };

/**
 * --- INITIALIZATION ---
 */
const initEarningsModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Calculating your profits...");

    try {
        // 2. Load Core Data
        await refreshAllData();

        // 3. Setup Real-time Listeners
        setupEarningsRealtime();

        // 4. Start Countdown Timer
        startEarningsCountdown();

        // 5. Setup UI Listeners
        setupUIEvents();

    } catch (err) {
        console.error("Earnings Init Error:", err);
        notify("Error loading earnings data. Please refresh.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */
const refreshAllData = async () => {
    await Promise.all([
        loadEarningsHistory(),
        loadFinancialSummary(),
        updateWalletDisplay()
    ]);
    renderEarningsCharts();
};

const loadEarningsHistory = async () => {
    const res = await getUserEarningsHistory(currentUser.id);
    if (res.success) {
        earningsHistory = res.data;
        renderHistoryList();
        updateStatsUI();
    }
};

const loadFinancialSummary = async () => {
    const res = await getEarningsStats(currentUser.id);
    if (res.success) {
        const data = res.data;
        // Map data to UI cards
        document.getElementById('totalEarnings').innerText = formatCurrency(data.totalEarnings);
        document.getElementById('todayEarnings').innerText = formatCurrency(data.todayEarnings);
        
        // Calculate other summary points (Weekly/Monthly) from history array
        calculateTimePeriodSummaries();
    }
};

const updateWalletDisplay = async () => {
    const res = await getUserWalletStats(currentUser.id);
    if (res.success) {
        const balEl = document.getElementById('walletBal');
        if (balEl) balEl.innerText = formatCurrency(res.data.balance);
    }
};

/**
 * --- UI RENDERING & LOGIC ---
 */

const renderHistoryList = () => {
    const container = document.getElementById('historyList');
    if (!container) return;

    const filtered = earningsHistory.filter(e => {
        const matchesSearch = e.id.includes(filters.search) || 
                              (e.investments?.plan_name && e.investments.plan_name.toLowerCase().includes(filters.search.toLowerCase()));
        return matchesSearch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No earnings history found.</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(e => {
        const date = new Date(e.created_at);
        return `
            <div class="history-item">
                <div class="hist-info">
                    <h5>${e.description || 'Daily Profit'}</h5>
                    <p>${formatDateTime(e.created_at)}</p>
                </div>
                <div class="hist-amount">
                    <h4>+${formatCurrency(e.amount)}</h4>
                    <span>CREDITED</span>
                </div>
            </div>
        `;
    }).join('');
};

const updateStatsUI = () => {
    if (earningsHistory.length === 0) return;

    const amounts = earningsHistory.map(e => parseFloat(e.amount));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);

    const avgEl = document.getElementById('avgEarnings');
    const highEl = document.getElementById('highestEarnings');
    const lowEl = document.getElementById('lowestEarnings');

    if (avgEl) avgEl.innerText = formatCurrency(avg);
    if (highEl) highEl.innerText = formatCurrency(max);
    if (lowEl) lowEl.innerText = formatCurrency(min);
};

const calculateTimePeriodSummaries = () => {
    const now = getLagosTime();
    const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const weekly = earningsHistory
        .filter(e => new Date(e.created_at) >= oneWeekAgo)
        .reduce((s, e) => s + parseFloat(e.amount), 0);

    const monthly = earningsHistory
        .filter(e => new Date(e.created_at) >= oneMonthAgo)
        .reduce((s, e) => s + parseFloat(e.amount), 0);

    const weekEl = document.getElementById('weeklyEarnings');
    const monthEl = document.getElementById('monthlyEarnings');

    if (weekEl) weekEl.innerText = formatCurrency(weekly);
    if (monthEl) monthEl.innerText = formatCurrency(monthly);
};

/**
 * --- EARNINGS COUNTDOWN (12:00 AM Lagos) ---
 */
const startEarningsCountdown = () => {
    const timerEl = document.getElementById('nextEarningsTimer');
    if (!timerEl) return;

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const now = getLagosTime();
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0); // Target 12:00 AM next day

        const diff = nextMidnight - now;

        if (diff <= 0) {
            // It's midnight! Refresh data after a small delay for DB processing
            timerEl.innerText = "Processing...";
            setTimeout(() => refreshAllData(), 5000);
            return;
        }

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        timerEl.innerText = `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }, 1000);
};

/**
 * --- ANALYTICS CHARTS ---
 */
const renderEarningsCharts = () => {
    const ctx = document.getElementById('earningsChart')?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;

    if (chartInstance) chartInstance.destroy();

    // Group last 7 days of earnings
    const labels = [];
    const dataPoints = [];
    const now = getLagosTime();

    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dStr = d.toLocaleDateString([], { weekday: 'short' });
        labels.push(dStr);

        const dailySum = earningsHistory
            .filter(e => new Date(e.created_at).toDateString() === d.toDateString())
            .reduce((s, e) => s + parseFloat(e.amount), 0);
        dataPoints.push(dailySum);
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Profit',
                data: dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { display: false },
                x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } }
            }
        }
    });
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupEarningsRealtime = () => {
    // Listen for new earnings transactions
    subscribeToTable('user-earnings-sync', 'transactions', 'INSERT', (payload) => {
        if (payload.new.user_id === currentUser.id && payload.new.type === 'earning') {
            refreshAllData();
            notify(`New Profit Credited: ${formatCurrency(payload.new.amount)}`, "success");
        }
    });
};

/**
 * --- EVENT LISTENERS ---
 */
const setupUIEvents = () => {
    document.getElementById('earnSearch')?.addEventListener('input', (e) => {
        filters.search = e.target.value;
        renderHistoryList();
    });

    // Time filter buttons (Today, Yesterday, etc.)
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Add custom period filtering logic here if desired
        });
    });
};

// Initial Load
document.addEventListener('DOMContentLoaded', initEarningsModule);

export { refreshAllData, startEarningsCountdown };
