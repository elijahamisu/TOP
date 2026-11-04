/**
 * TOP - Referral Module
 * Handles dynamic link generation, referral tracking, leaderboard analytics,
 * and social sharing integration with real-time Supabase sync.
 */

import { ENV, formatCurrency } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader, copyToClipboard } from './app.js';
import { getUserReferralInfo, getReferralStats, getReferralLeaderboard } from '../api/referrals.js';
import { getPlatformSettings } from '../api/settings.js';

// --- Module State ---
let currentUser = null;
let referralCode = "";
let referralLink = "";
let referralHistory = [];
let filters = { search: '', status: 'all' };

/**
 * --- INITIALIZATION ---
 */
const initReferralModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Loading your referral network...");

    try {
        // 2. Load Core Data
        await Promise.all([
            loadReferralIdentity(),
            loadReferralCommission(),
            refreshReferralData(),
            loadLeaderboard()
        ]);

        // 3. Setup Real-time Listeners
        setupReferralRealtime();

        // 4. Bind Search & Filter Listeners
        setupUIEvents();

    } catch (err) {
        console.error("Referral Init Error:", err);
        notify("Failed to load referral data. Please refresh.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */

/**
 * Fetches the user's unique code and generates the dynamic link based on current domain.
 */
const loadReferralIdentity = async () => {
    const res = await getUserReferralInfo(currentUser.id);
    if (res.success) {
        referralCode = res.data.code;
        // Generate link dynamically using window.location.origin
        referralLink = `${window.location.origin}/register.html?ref=${referralCode}`;
        
        // Update UI
        const codeEl = document.getElementById('refCodeDisplay');
        if (codeEl) codeEl.innerText = referralCode;
    }
};

/**
 * Loads the platform-wide commission percentage from settings.
 */
const loadReferralCommission = async () => {
    const res = await getPlatformSettings();
    if (res.success) {
        const commEl = document.getElementById('refCommission'); // If exists in UI
        if (commEl) commEl.innerText = `${res.data.referral_percent}%`;
    }
};

/**
 * Fetches stats and history.
 */
const refreshReferralData = async () => {
    // Stats
    const statsRes = await getReferralStats(currentUser.id);
    if (statsRes.success) {
        document.getElementById('totalRefs').innerText = statsRes.data.totalReferrals;
        document.getElementById('totalRefEarnings').innerText = formatCurrency(statsRes.data.totalEarnings);
        
        // Month logic (calculated from local date filter if needed)
        const monthEl = document.getElementById('monthRefEarnings');
        if (monthEl) monthEl.innerText = formatCurrency(statsRes.data.totalEarnings); // Placeholder for monthly logic
    }

    // History (List of users referred)
    const { data: users, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, created_at, status')
        .eq('referral_by', referralCode)
        .order('created_at', { ascending: false });

    if (!error) {
        referralHistory = users;
        renderReferralList();
    }
};

/**
 * Loads the Global Referral Leaderboard.
 */
const loadLeaderboard = async () => {
    const res = await getReferralLeaderboard();
    const container = document.getElementById('topReferrersBody');
    if (!container || !res.success) return;

    if (res.data.length === 0) {
        container.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">No records yet.</td></tr>`;
        return;
    }

    container.innerHTML = res.data.map((r, i) => `
        <tr>
            <td><b style="color:var(--gold)">#${i+1}</b></td>
            <td>${r.name}</td>
            <td><span style="font-family:monospace; color:var(--accent-color)">${r.username.toUpperCase()}</span></td>
            <td>${r.count}</td>
            <td style="color:var(--success); font-weight:700">${formatCurrency(r.totalEarned)}</td>
        </tr>
    `).join('');
};

/**
 * --- UI RENDERING ---
 */

const renderReferralList = () => {
    const container = document.getElementById('referralList');
    if (!container) return;

    const filtered = referralHistory.filter(u => {
        const matchesSearch = u.full_name.toLowerCase().includes(filters.search.toLowerCase()) || 
                              u.username.toLowerCase().includes(filters.search.toLowerCase());
        const matchesStatus = filters.status === 'all' || (filters.status === 'active' ? u.status === 'active' : true);
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No referrals found.</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(u => `
        <div class="list-item">
            <div class="user-info">
                <h5>${u.full_name}</h5>
                <p>Joined ${new Date(u.created_at).toLocaleDateString()}</p>
            </div>
            <div class="user-status">
                <span class="badge ${u.status === 'active' ? 'active' : 'registered'}">
                    ${u.status === 'active' ? 'Active Investor' : 'Registered'}
                </span>
            </div>
        </div>
    `).join('');
};

/**
 * --- ACTIONS ---
 */

window.copyCode = () => {
    if (!referralCode) return;
    copyToClipboard(referralCode);
    notify("Referral code copied!", "success");
};

window.copyLink = () => {
    if (!referralLink) return;
    copyToClipboard(referralLink);
    notify("Referral link copied!", "success");
};

/**
 * Social Sharing Handlers
 */
window.shareReferral = (platform) => {
    const text = `Join ${ENV.APP_NAME} and earn daily Naira profits! Use my link to register: `;
    const encodedText = encodeURIComponent(text);
    const encodedLink = encodeURIComponent(referralLink);

    const shareUrls = {
        whatsapp: `https://api.whatsapp.com/send?text=${encodedText}${encodedLink}`,
        telegram: `https://t.me/share/url?url=${encodedLink}&text=${encodedText}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`,
        twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedLink}`,
        email: `mailto:?subject=Investment Opportunity&body=${text}${referralLink}`
    };

    if (shareUrls[platform]) {
        window.open(shareUrls[platform], '_blank');
    }
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupReferralRealtime = () => {
    // 1. Watch for new users signing up with your code
    subscribeToTable('new-referral-signup', 'profiles', 'INSERT', (payload) => {
        if (payload.new.referral_by === referralCode) {
            refreshReferralData();
            notify("New Referral registered via your link!", "info");
        }
    });

    // 2. Watch for referral rewards (transactions)
    subscribeToTable('referral-reward-sync', 'transactions', 'INSERT', (payload) => {
        if (payload.new.user_id === currentUser.id && payload.new.type === 'referral') {
            refreshReferralData();
            notify(`Referral Commission Credited: ${formatCurrency(payload.new.amount)}`, "success");
        }
    });
};

/**
 * --- EVENT LISTENERS ---
 */
const setupUIEvents = () => {
    document.getElementById('refSearch')?.addEventListener('input', (e) => {
        filters.search = e.target.value;
        renderReferralList();
    });

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filters.status = e.target.value;
            renderReferralList();
        });
    }
};

// Initial Load
document.addEventListener('DOMContentLoaded', initReferralModule);

export { refreshReferralData, loadLeaderboard };
