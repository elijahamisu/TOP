/**
 * TOP - Investment Module
 * Manages plan selection, investment creation, real-time progress tracking,
 * and automated earnings countdowns.
 */

import { ENV, formatCurrency, formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { createInvestment as apiCreateInvestment } from '../api/investments.js';
import { getUserWalletStats } from '../api/users.js';

// --- State Management ---
let currentUser = null;
let currentWallet = 0;
let userInvestments = [];
let filters = { search: '', status: 'active' };

/**
 * --- INITIALIZATION ---
 */
const initInvestmentModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    const path = window.location.pathname;

    // 2. Context-based Loading
    if (path.includes('plans.html')) {
        await loadInvestmentPlans();
    } else if (path.includes('investment.html')) {
        await loadUserInvestments();
    }

    // 3. Shared Data & Listeners
    await updateLocalWalletBalance();
    setupInvestmentRealtime();
    startMidnightCountdown();
};

/**
 * --- DATA LOADING ---
 */

const updateLocalWalletBalance = async () => {
    const res = await getUserWalletStats(currentUser.id);
    if (res.success) {
        currentWallet = res.data.balance;
        const balEl = document.getElementById('walletDisplay');
        if (balEl) balEl.innerText = formatCurrency(currentWallet);
    }
};

const loadInvestmentPlans = async () => {
    const list = document.getElementById('plansList');
    if (!list) return;

    // Fetch plans from Supabase (assuming a table named 'investment_plans')
    const { data: plans, error } = await supabase
        .from('investment_plans')
        .select('*')
        .eq('is_available', true)
        .order('min_amount', { ascending: true });

    if (error || !plans) {
        notify("Could not load investment plans.", "error");
        return;
    }

    list.innerHTML = plans.map(plan => `
        <div class="plan-card">
            <div class="plan-badge">${plan.daily_profit_percent}% Daily</div>
            <h3>${plan.name}</h3>
            <p class="profit-tag">Earn ${plan.daily_profit_percent}% daily for ${plan.duration_days} days</p>
            <div class="plan-specs">
                <div class="spec-item"><p>Min Invest</p><h5>${formatCurrency(plan.min_amount)}</h5></div>
                <div class="spec-item"><p>Max Invest</p><h5>${formatCurrency(plan.max_amount)}</h5></div>
            </div>
            <button class="btn-invest" onclick="initiatePlanSelection(${JSON.stringify(plan).replace(/"/g, '&quot;')})">Select Plan</button>
        </div>
    `).join('');
};

const loadUserInvestments = async () => {
    const list = document.getElementById('activeList');
    if (!list) return;

    const { data, error } = await supabase
        .from('investments')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        notify("Error loading investments.", "error");
        return;
    }

    userInvestments = data;
    renderInvestmentList();
};

/**
 * --- UI RENDERING ---
 */

const renderInvestmentList = () => {
    const container = document.getElementById('activeList');
    if (!container) return;

    const filtered = userInvestments.filter(inv => {
        const matchesSearch = inv.plan_name.toLowerCase().includes(filters.search.toLowerCase());
        const matchesStatus = filters.status === 'all' || inv.status === filters.status;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No investments found.</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(inv => {
        const progress = calculateProgress(inv.start_date, inv.end_date);
        const daysLeft = Math.max(0, Math.ceil((new Date(inv.end_date) - new Date()) / (1000 * 60 * 60 * 24)));
        
        return `
            <div class="inv-card">
                <div class="inv-main">
                    <h4>${inv.plan_name} <span class="status-badge status-${inv.status}">${inv.status}</span></h4>
                    <p>Principal: ${formatCurrency(inv.amount)}</p>
                    <div style="margin-top:10px; height:4px; background:rgba(255,255,255,0.05); border-radius:10px; overflow:hidden;">
                        <div style="width:${progress}%; height:100%; background:var(--accent-color);"></div>
                    </div>
                </div>
                <div class="inv-stats">
                    <h5>+${formatCurrency(inv.daily_profit)}</h5>
                    <p>${daysLeft} days left</p>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * --- INVESTMENT ACTIONS ---
 */

// Triggered from plans.html to investment.html
window.initiatePlanSelection = (plan) => {
    // Store selected plan data for the confirmation page
    sessionStorage.setItem('temp_selected_plan', JSON.stringify(plan));
    window.location.href = 'investment.html';
};

/**
 * Core function to finalize investment
 * (Typically called from the confirm modal in investment.html)
 */
export const executeInvestmentFlow = async (amount) => {
    const planStr = sessionStorage.getItem('temp_selected_plan');
    if (!planStr) {
        notify("No plan selected.", "error");
        return;
    }

    const plan = JSON.parse(planStr);
    
    toggleLoader(true, "Processing Investment...");

    const result = await apiCreateInvestment({
        planName: plan.name,
        amount: amount,
        dailyProfit: (amount * plan.daily_profit_percent) / 100,
        profitPercent: plan.daily_profit_percent,
        duration: plan.duration_days,
        minLimit: plan.min_amount,
        maxLimit: plan.max_amount
    });

    if (result.success) {
        sessionStorage.removeItem('temp_selected_plan');
        notify("Investment successfully activated!", "success");
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
    } else {
        notify(result.error || "Investment failed.", "error");
        toggleLoader(false);
    }
};

/**
 * --- UTILITIES & REALTIME ---
 */

const calculateProgress = (start, end) => {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const now = new Date().getTime();
    const total = endTime - startTime;
    const current = now - startTime;
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
};

const setupInvestmentRealtime = () => {
    // Watch for status changes (Admin pause/resume/cancel)
    subscribeToTable('user-inv-changes', 'investments', 'UPDATE', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            loadUserInvestments();
            notify(`Investment Status Updated: ${payload.new.status}`, "info");
        }
    });
};

const startMidnightCountdown = () => {
    const timerEl = document.getElementById('nextEarningsTimer');
    if (!timerEl) return;

    const updateTimer = () => {
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0); // Midnight Lagos
        
        const diff = midnight - now;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        
        timerEl.innerText = `${h}h ${m}m ${s}s`;
    };

    setInterval(updateTimer, 1000);
    updateTimer();
};

// Event Listeners for Search/Filters
document.getElementById('invSearch')?.addEventListener('input', (e) => {
    filters.search = e.target.value;
    renderInvestmentList();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        filters.status = btn.dataset.status;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderInvestmentList();
    });
});

// Load on DOM ready
document.addEventListener('DOMContentLoaded', initInvestmentModule);

export { loadUserInvestments };
