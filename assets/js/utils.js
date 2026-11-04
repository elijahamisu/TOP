/**
 * TOP - Global Utility Library
 * Reusable helper functions for Validation, Formatting, UI, and Security.
 */

import { ENV } from '../config/env.js';

/**
 * --- CATEGORY: VALIDATION HELPERS ---
 */

export const validate = {
    /** Checks if a string is empty or just whitespace */
    required: (val) => val && val.trim().length > 0,

    /** Validates email format */
    email: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),

    /** Validates username (alphanumeric, 3-15 chars) */
    username: (val) => /^[a-zA-Z0-9_]{3,15}$/.test(val),

    /** Validates Nigerian phone number */
    phone: (val) => /^(070|080|081|090|091|071)\d{8}$/.test(val),

    /** Validates minimum investment/deposit amount */
    minAmount: (val, min = 1000) => parseFloat(val) >= min,

    /** Validates 10-digit bank account number */
    accountNumber: (val) => /^\d{10}$/.test(val),

    /** Checks password strength (min 6 chars, 1 letter, 1 number) */
    passwordStrength: (val) => {
        if (!val || val.length < 6) return { score: 1, label: 'Weak' };
        let strength = 0;
        if (/[a-zA-Z]/.test(val)) strength++;
        if (/[0-9]/.test(val)) strength++;
        if (/[^a-zA-Z0-9]/.test(val)) strength++;
        if (val.length >= 10) strength++;
        
        const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
        return { score: strength + 1, label: labels[strength] };
    }
};

/**
 * --- CATEGORY: CURRENCY & NUMBER HELPERS ---
 */

/** Formats a number to Nigerian Naira (₦) */
export const formatNaira = (amount) => {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        currencyDisplay: 'symbol',
        minimumFractionDigits: 2
    }).format(amount || 0).replace('NGN', '₦');
};

/** Calculates percentage progress (e.g. for investment bars) */
export const calcProgress = (start, end) => {
    const total = new Date(end) - new Date(start);
    const elapsed = new Date() - new Date(start);
    const percent = Math.round((elapsed / total) * 100);
    return Math.min(100, Math.max(0, percent));
};

/**
 * --- CATEGORY: DATE & TIME HELPERS (Africa/Lagos) ---
 */

/** Returns current time in Lagos as a Date object */
export const getLagosNow = () => {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
};

/** Formats date into: 24 Oct 2026 */
export const formatDateShort = (date) => {
    return new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
    });
};

/** Formats time into: 12:00 AM */
export const formatTimeShort = (date) => {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });
};

/** Returns countdown to next 12:00 AM Lagos */
export const getMidnightCountdown = () => {
    const now = getLagosNow();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const diff = midnight - now;

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return { h, m, s, string: `${h}h ${m}m ${s}s` };
};

/**
 * --- CATEGORY: STRING & ID HELPERS ---
 */

export const str = {
    capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
    
    /** Generates random 10-char Transaction ID */
    genTxId: () => 'TX-' + Math.random().toString(36).substr(2, 10).toUpperCase(),
    
    /** Generates 6-char Referral Code */
    genRefCode: () => Math.random().toString(36).substr(2, 6).toUpperCase(),

    /** Escapes HTML to prevent XSS */
    escape: (html) => {
        const div = document.createElement('div');
        div.textContent = html;
        return div.innerHTML;
    }
};

/**
 * --- CATEGORY: BROWSER & UI HELPERS ---
 */

/** Copies text to clipboard and shows a toast */
export const copyText = async (text, label = "Item") => {
    try {
        await navigator.clipboard.writeText(text);
        showToast(`${label} copied to clipboard!`, 'success');
    } catch (err) {
        showToast('Failed to copy.', 'error');
    }
};

/** Simple Toast Notification System */
export const showToast = (msg, type = 'info') => {
    const container = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-times-circle' : 'fa-info-circle');
    
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3500);
};

const createToastContainer = () => {
    const div = document.createElement('div');
    div.id = 'toast-container';
    div.style.cssText = 'position:fixed; bottom:80px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:10px; width:90%; max-width:400px;';
    document.body.appendChild(div);
    return div;
};

/**
 * --- CATEGORY: LOADING HELPERS ---
 */

/** Toggles loading state on a button */
export const btnLoading = (btnSelector, isLoading, originalText = "Submit") => {
    const btn = document.querySelector(btnSelector);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Processing...`;
    } else {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

/**
 * --- CATEGORY: NETWORK HELPERS ---
 */

export const isOnline = () => navigator.onLine;

/**
 * --- CATEGORY: STORAGE HELPERS ---
 */

export const storage = {
    set: (key, val) => localStorage.setItem(`top_${key}`, JSON.stringify(val)),
    get: (key) => {
        const val = localStorage.getItem(`top_${key}`);
        try { return val ? JSON.parse(val) : null; } catch { return null; }
    },
    remove: (key) => localStorage.removeItem(`top_${key}`),
    clear: () => localStorage.clear()
};

/**
 * --- CATEGORY: URL & REDIRECTION ---
 */

export const url = {
    /** Gets value of a query parameter */
    getParam: (name) => new URLSearchParams(window.location.search).get(name),
    
    /** Redirects to a new page */
    redirect: (path) => window.location.href = path,
    
    /** Gets the full referral link */
    getRefLink: (code) => `${window.location.origin}/register.html?ref=${code}`
};

/**
 * --- CATEGORY: FILE HELPERS ---
 */

export const file = {
    /** Validates image size and type */
    isValidImage: (file, maxSizeMB = 2) => {
        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const isValidType = validTypes.includes(file.type);
        const isValidSize = file.size <= maxSizeMB * 1024 * 1024;
        return { valid: isValidType && isValidSize, error: !isValidType ? "Invalid file type." : (!isValidSize ? "File too large." : null) };
    }
};

/**
 * --- CATEGORY: PERFORMANCE ---
 */

/** Debounce function to limit execution rate */
export const debounce = (func, delay = 300) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};
