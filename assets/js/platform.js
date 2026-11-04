/**
 * TOP - Platform settings applied on every user page.
 * Reads the single platform_settings row (public read) and applies:
 *  - Maintenance Mode (admins bypass)
 *  - Session Timeout (sign out after N idle minutes)
 *  - Platform name, description, support email, Telegram community link
 * Exposes window.TOPSettings (a promise of the settings row).
 */
import { supabase } from '../../config/supabase.js';
import './sidebar.js';

const COMMUNITY_LINK = /^https:\/\/t\.me\/\+/; // the "community / group" invite links
const CHANNEL_LINK = /^https:\/\/t\.me\/monvexachannel\/?$/; // the default channel link

async function loadSettings() {
    const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
    return data || {};
}

const settingsPromise = loadSettings().catch(() => ({}));
window.TOPSettings = settingsPromise;

function applyBranding(s) {
    if (s.app_name && s.app_name !== 'TOP') {
        document.title = document.title.replace(/\bTOP\b/g, s.app_name);
        document.querySelectorAll('meta[name="application-name"]').forEach(m => m.setAttribute('content', s.app_name));
        document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = s.app_name; });
        document.querySelectorAll('img[alt="TOP"]').forEach(el => { el.alt = s.app_name; });
    }
    if (s.app_description) {
        document.querySelectorAll('meta[name="description"]').forEach(m => m.setAttribute('content', s.app_description));
    }
    if (s.telegram_link) {
        document.querySelectorAll('a[href]').forEach(a => {
            if (COMMUNITY_LINK.test(a.getAttribute('href'))) a.setAttribute('href', s.telegram_link);
        });
    }
    if (s.telegram_channel_link) {
        document.querySelectorAll('a[href]').forEach(a => {
            if (CHANNEL_LINK.test(a.getAttribute('href'))) a.setAttribute('href', s.telegram_channel_link);
        });
    }
    document.querySelectorAll('[data-support-email]').forEach(el => {
        if (s.support_email) {
            el.style.display = '';
            el.querySelectorAll('a').forEach(a => { a.href = 'mailto:' + s.support_email; a.textContent = s.support_email; });
        } else {
            el.style.display = 'none';
        }
    });
}

function showMaintenance(s) {
    const name = s.app_name || 'TOP';
    const overlay = document.createElement('div');
    overlay.id = 'maintenanceOverlay';
    overlay.setAttribute('role', 'alert');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;background:#0b0b0d;color:#fff;text-align:center;font-family:inherit;';
    overlay.innerHTML = `
        <div style="max-width:420px">
            <div style="font-size:48px;margin-bottom:12px">&#128295;</div>
            <h2 style="margin:0 0 10px;font-size:24px">${name} is under maintenance</h2>
            <p style="margin:0 0 18px;opacity:.8;line-height:1.5">We're making some improvements. Please check back shortly. Your funds and investments are safe.</p>
            ${s.telegram_link ? `<a href="${s.telegram_link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#b3001b;color:#fff;text-decoration:none;font-weight:600">Updates on Telegram</a>` : ''}
        </div>`;
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
}

function isDashboard() {
    const path = window.location.pathname.replace(/\/+$/, '');
    return /\/dashboard(\.html)?$/.test(path);
}

// Dashboard Telegram popup: shows on every dashboard load/refresh, text and links set in Admin > Settings.
function showTelegramPopup(s) {
    if (s.telegram_popup_enabled === false) return;
    const group = s.telegram_link;
    const channel = s.telegram_channel_link;
    if (!group && !channel) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay is-open';
    overlay.id = 'telegramPopup';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML = '<i class="fab fa-telegram"></i><h2></h2><p></p><div class="modal-btns"></div>';
    card.querySelector('h2').textContent = s.telegram_popup_title || 'Join Our Community';
    card.querySelector('p').textContent = s.telegram_popup_message ||
        'Join our Telegram community for investment updates, announcements, and 24/7 support.';
    const btns = card.querySelector('.modal-btns');
    const addLink = (href, text, cls, icon) => {
        if (!href) return;
        const a = document.createElement('a');
        a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-block ' + cls;
        a.innerHTML = `<i class="${icon}"></i> `;
        a.append(document.createTextNode(text));
        a.addEventListener('click', () => setTimeout(close, 300));
        btns.appendChild(a);
    };
    addLink(group, s.telegram_group_button || 'Join Telegram Group', 'btn-primary', 'fab fa-telegram');
    addLink(channel, s.telegram_channel_button || 'Join Telegram Channel', 'btn-outline', 'fas fa-bullhorn');
    const later = document.createElement('button');
    later.type = 'button'; later.className = 'btn btn-ghost btn-block'; later.textContent = 'Maybe Later';
    later.addEventListener('click', close);
    btns.appendChild(later);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
}

function startSessionTimeout(minutes) {
    const limit = Number(minutes);
    if (!limit || limit <= 0) return;
    const KEY = 'top_last_activity';
    const ms = limit * 60 * 1000;
    const touch = () => localStorage.setItem(KEY, String(Date.now()));
    const last = Number(localStorage.getItem(KEY) || 0);
    if (last && Date.now() - last > ms) return expire();
    touch();
    let lastWrite = Date.now();
    ['click', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(evt =>
        window.addEventListener(evt, () => { if (Date.now() - lastWrite > 15000) { touch(); lastWrite = Date.now(); } }, { passive: true }));
    setInterval(() => {
        const seen = Number(localStorage.getItem(KEY) || 0);
        if (Date.now() - seen > ms) expire();
    }, 30000);

    async function expire() {
        localStorage.removeItem(KEY);
        await supabase.auth.signOut();
        window.location.href = '/login.html?expired=1';
    }
}

(async () => {
    const s = await settingsPromise;
    const ready = () => applyBranding(s);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

    const { data: { session } } = await supabase.auth.getSession();
    let isAdmin = false;
    if (session) {
        const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', session.user.id).single();
        isAdmin = !!p?.is_admin;
    }

    if (s.maintenance_mode && !isAdmin) {
        const show = () => showMaintenance(s);
        if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
        return;
    }

    if (session && !isAdmin) startSessionTimeout(s.session_timeout);

    if (session && isDashboard()) {
        const show = () => showTelegramPopup(s);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
    }
})();
