/**
 * TOP - Core Application Controller
 * Handles initialization, authentication guarding, global UI components,
 * and shared utility services.
 */

import { ENV, formatCurrency, formatDate, formatTime } from '../config/env.js';
import { supabase, getCurrentUser, isAuthenticated, signOut } from '../config/supabase.js';

// --- Global Application State ---
const AppState = {
    isInitialized: false,
    user: null,
    profile: null,
    isOnline: navigator.onLine,
};

/**
 * --- INITIALIZATION ---
 */
const initApp = async () => {
    if (AppState.isInitialized) return;

    // 1. Monitor Network Connection
    window.addEventListener('online', () => handleNetworkChange(true));
    window.addEventListener('offline', () => handleNetworkChange(false));

    // 2. Run Auth Guard
    await authGuard();

    // 3. Initialize Global UI Components
    setupNavigation();
    setupGlobalListeners();

    AppState.isInitialized = true;
    console.log(`${ENV.APP_NAME} initialized successfully.`);
};

/**
 * --- AUTHENTICATION & SECURITY ROUTING ---
 */
const authGuard = async () => {
    const user = await getCurrentUser();
    const path = window.location.pathname;
    const isPublicPage = ['/', '/index.html', '/login.html', '/register.html', '/terms.html', '/support.html'].includes(path);
    const isAdminPath = path.includes('/admin/');

    // User is logged in
    if (user) {
        AppState.user = user;
        // Fetch Profile for Global Use
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        AppState.profile = profile;

        // Redirect logged-in users away from Login/Register to Dashboard
        if (path === '/login.html' || path === '/register.html') {
            window.location.href = isAdminPath ? '/admin/index.html' : '/dashboard.html';
        }

        // Admin Security: Redirect non-admins away from admin pages
        if (isAdminPath && !profile?.is_admin) {
            window.location.href = '/login.html';
        }

        // Initialize Realtime for notifications and wallet balance
        initGlobalRealtime(user.id);
        
        // Check for Telegram Popup (Triggered after successful Login/Registration)
        checkTelegramPopup();
    } 
    // User is NOT logged in
    else {
        // Redirect if trying to access protected user or admin pages
        if (!isPublicPage && path !== '/admin/login.html') {
            window.location.href = isAdminPath ? '/admin/login.html' : '/login.html';
        }
    }
};

/**
 * --- GLOBAL UI: NAVIGATION ---
 */
const setupNavigation = () => {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');

    if (menuBtn && sidebar) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    // Highlight active link
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item, .nav-links a').forEach(link => {
        if (link.getAttribute('href') === currentPath.split('/').pop()) {
            link.classList.add('active');
        }
    });
};

/**
 * --- GLOBAL UI: NOTIFICATIONS (TOASTS) ---
 */
export const notify = (message, type = 'info') => {
    const toastContainer = document.getElementById('global-toasts') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} slide-in`;
    
    const icon = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    }[type];

    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;

    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

const createToastContainer = () => {
    const container = document.createElement('div');
    container.id = 'global-toasts';
    container.style.cssText = 'position:fixed; top:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px;';
    document.body.appendChild(container);
    return container;
};

/**
 * --- TELEGRAM POPUP LOGIC ---
 */
const checkTelegramPopup = () => {
    const loginFlag = sessionStorage.getItem('just_logged_in');
    const popupSeen = localStorage.getItem('tg_popup_dismissed');

    if (loginFlag && !popupSeen) {
        showTelegramModal();
        sessionStorage.removeItem('just_logged_in');
    }
};

const showTelegramModal = () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-card scale-in" style="max-width: 400px; text-align: center; background: #0a0f1a; padding: 30px; border-radius: 20px; border: 1px solid #3b82f6;">
            <i class="fab fa-telegram" style="font-size: 50px; color: #229ED9; margin-bottom: 20px;"></i>
            <h2 style="margin-bottom: 10px;">Join Our Community!</h2>
            <p style="color: #9ca3af; font-size: 14px; margin-bottom: 25px;">Get instant updates, investment tips, and 24/7 support in our official Telegram group.</p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <a href="${ENV.TELEGRAM_LINK}" target="_blank" class="btn-prime" style="background:#229ED9; text-decoration:none; display:block; padding:12px; border-radius:10px; font-weight:700;">Join Telegram Group</a>
                <a href="${ENV.TELEGRAM_CHANNEL_LINK}" target="_blank" class="btn-prime" style="background:transparent; border:1px solid #229ED9; color:#229ED9; text-decoration:none; display:block; padding:12px; border-radius:10px; font-weight:700;">Join Telegram Channel</a>
                <button id="closeTgPopup" style="background:transparent; border:none; color:#9ca3af; cursor:pointer; font-size:13px;">Maybe Later</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeTgPopup').onclick = () => {
        localStorage.setItem('tg_popup_dismissed', 'true');
        modal.remove();
    };
};

/**
 * --- LOADING SYSTEM ---
 */
export const toggleLoader = (show, text = 'Loading...') => {
    let loader = document.getElementById('app-loader');
    if (!loader && show) {
        loader = document.createElement('div');
        loader.id = 'app-loader';
        loader.className = 'overlay-loader';
        loader.innerHTML = `
            <div style="text-align:center">
                <div class="spinner"></div>
                <p style="margin-top:15px; color:#9ca3af; font-size:14px;">${text}</p>
            </div>
        `;
        document.body.appendChild(loader);
    }
    if (loader) loader.style.display = show ? 'flex' : 'none';
};

/**
 * --- REALTIME SYNC ---
 */
const initGlobalRealtime = (userId) => {
    // Listen for new user notifications
    supabase.channel('user-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, 
        (payload) => {
            notify(`New Alert: ${payload.new.title}`, 'info');
            // Refresh notification dots in UI if they exist
            const dot = document.getElementById('notifDot');
            if (dot) dot.style.display = 'block';
        })
        .subscribe();
};

/**
 * --- NETWORK & UTILITIES ---
 */
const handleNetworkChange = (online) => {
    AppState.isOnline = online;
    if (!online) {
        notify('Internet connection lost. You are currently offline.', 'warning');
    } else {
        notify('Internet connection restored.', 'success');
    }
};

export const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        notify('Copied to clipboard!', 'success');
    } catch (err) {
        notify('Failed to copy text.', 'error');
    }
};

const setupGlobalListeners = () => {
    // Scroll to Top helper
    document.querySelectorAll('[data-scroll-top]').forEach(btn => {
        btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    });
};

// Initialize the app on load
window.addEventListener('DOMContentLoaded', initApp);

// Export utilities for page-specific scripts
export {
    AppState,
    formatCurrency,
    formatDate,
    formatTime,
    signOut
};
