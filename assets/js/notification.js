/**
 * TOP - Notification Module
 * Handles real-time alerts, read/unread state management, broadcast messages,
 * and global notification badge synchronization.
 */

import { formatDateTime } from '../config/env.js';
import { supabase, subscribeToTable } from '../config/supabase.js';
import { protectPage } from './auth.js';
import { notify, toggleLoader } from './app.js';
import { 
    getUserNotifications, 
    markAsRead as apiMarkAsRead, 
    markAllAsRead as apiMarkAllRead,
    deleteNotification as apiDeleteNotif,
    getNotificationStats
} from '../api/notifications.js';

// --- Module State ---
let currentUser = null;
let allNotifications = [];
let filters = { search: '', type: 'all' };

/**
 * --- INITIALIZATION ---
 */
const initNotificationModule = async () => {
    // 1. Auth Guard
    currentUser = await protectPage();
    if (!currentUser) return;

    toggleLoader(true, "Fetching alerts...");

    try {
        // 2. Load Notifications & Stats
        await refreshNotifications();

        // 3. Start Real-time Subscription
        setupNotificationRealtime();

        // 4. Bind UI Event Listeners
        setupUIEvents();

    } catch (err) {
        console.error("Notification Init Error:", err);
        notify("Failed to sync notifications.", "error");
    } finally {
        toggleLoader(false);
    }
};

/**
 * --- DATA LOADING ---
 */

const refreshNotifications = async () => {
    const res = await getUserNotifications({ type: filters.type });
    if (res.success) {
        allNotifications = res.data;
        renderNotificationList();
        await updateGlobalBadges();
    }
};

/**
 * Updates unread counts on Dashboard, Header, and Nav
 */
const updateGlobalBadges = async () => {
    const res = await getNotificationStats(currentUser.id);
    if (res.success) {
        const unreadCount = res.data.unread;
        
        // Update all elements with class 'notif-count' or ID 'unreadCount'
        const badgeElements = document.querySelectorAll('.notification-dot, #unreadCount, #notifDot');
        badgeElements.forEach(el => {
            if (unreadCount > 0) {
                el.style.display = 'block';
                if (el.tagName !== 'DIV') el.innerText = unreadCount;
            } else {
                el.style.display = 'none';
            }
        });

        // Update summary cards if on notifications.html
        const totalEl = document.getElementById('totalCount');
        const unreadEl = document.getElementById('unreadCountDisplay');
        if (totalEl) totalEl.innerText = res.data.total;
        if (unreadEl) unreadEl.innerText = unreadCount;
    }
};

/**
 * --- UI RENDERING ---
 */

const renderNotificationList = () => {
    const container = document.getElementById('notifList');
    if (!container) return;

    const filtered = allNotifications.filter(n => {
        const matchesSearch = n.title.toLowerCase().includes(filters.search.toLowerCase()) || 
                              n.message.toLowerCase().includes(filters.search.toLowerCase());
        return matchesSearch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bell-slash"></i>
                <p>You're all caught up!</p>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(n => {
        const iconMap = {
            deposit: 'fa-plus-circle',
            withdrawal: 'fa-arrow-down',
            investment: 'fa-rocket',
            earning: 'fa-chart-line',
            gift: 'fa-gift',
            referral: 'fa-users',
            welcome: 'fa-hand-sparkles',
            broadcast: 'fa-bullhorn',
            system: 'fa-shield-alt'
        };

        return `
            <div class="notif-item ${n.is_read ? '' : 'unread'}" id="notif-${n.id}">
                <div class="notif-icon">
                    <i class="fas ${iconMap[n.type] || 'fa-bell'}"></i>
                </div>
                <div class="notif-body">
                    <h4>${n.title}</h4>
                    <p>${n.message}</p>
                    <div class="notif-time">${formatDateTime(n.created_at)}</div>
                    <div class="notif-actions">
                        ${!n.is_read ? `<button class="btn-mini mark" onclick="handleMarkRead('${n.id}')">Mark as Read</button>` : ''}
                        <button class="btn-mini del" onclick="handleDeleteNotif('${n.id}')">Delete</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * --- ACTIONS ---
 */

window.handleMarkRead = async (id) => {
    const res = await apiMarkAsRead(id);
    if (res.success) {
        // Optimistic UI update
        const item = document.getElementById(`notif-${id}`);
        if (item) {
            item.classList.remove('unread');
            const btn = item.querySelector('.mark');
            if (btn) btn.remove();
        }
        await updateGlobalBadges();
    }
};

window.handleMarkAllRead = async () => {
    toggleLoader(true, "Clearing alerts...");
    const res = await apiMarkAllRead();
    if (res.success) {
        notify("All notifications marked as read.", "success");
        await refreshNotifications();
    }
    toggleLoader(false);
};

window.handleDeleteNotif = async (id) => {
    if (confirm("Delete this notification?")) {
        const res = await apiDeleteNotif(id);
        if (res.success) {
            document.getElementById(`notif-${id}`)?.remove();
            allNotifications = allNotifications.filter(n => n.id !== id);
            await updateGlobalBadges();
            if (allNotifications.length === 0) renderNotificationList();
        }
    }
};

/**
 * --- REAL-TIME UPDATES ---
 */
const setupNotificationRealtime = () => {
    // Listen for new notifications specifically for this user
    subscribeToTable('user-notifs-realtime', 'notifications', 'INSERT', (payload) => {
        if (payload.new.user_id === currentUser.id) {
            allNotifications.unshift(payload.new);
            renderNotificationList();
            updateGlobalBadges();
            // Show global toast via app.js
            notify(`New Notification: ${payload.new.title}`, "info");
        }
    });

    // Listen for deletions
    subscribeToTable('user-notifs-delete', 'notifications', 'DELETE', (payload) => {
        allNotifications = allNotifications.filter(n => n.id !== payload.old.id);
        renderNotificationList();
        updateGlobalBadges();
    });
};

/**
 * --- UI EVENTS ---
 */
const setupUIEvents = () => {
    // Search
    document.getElementById('notifSearch')?.addEventListener('input', (e) => {
        filters.search = e.target.value;
        renderNotificationList();
    });

    // Category Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filters.type = tab.dataset.type || 'all';
            refreshNotifications();
        });
    });
};

// Initial Load
document.addEventListener('DOMContentLoaded', initNotificationModule);

export { refreshNotifications, updateGlobalBadges };
