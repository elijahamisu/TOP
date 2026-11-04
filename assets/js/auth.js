/**
 * TOP - Authentication Module
 * Manages User/Admin Auth flows, Referral detection, 
 * Validation, and Session synchronization.
 */

import { ENV } from '../config/env.js';
import { supabase, getCurrentUser, getCurrentSession, signOut } from '../config/supabase.js';
import { registerUser as apiRegister, loginUser as apiLogin, loginAdmin as apiAdminLogin } from '../api/auth.js';
import { notify, toggleLoader } from './app.js';

/**
 * --- INITIALIZATION & REFERRAL DETECTION ---
 */
document.addEventListener('DOMContentLoaded', () => {
    handleReferralDetection();
    setupPasswordVisibility();
});

/**
 * Detects referral code from URL and auto-fills the registration form.
 * URL Format: register.html?ref=REFERRAL_CODE
 */
const handleReferralDetection = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    const refInput = document.getElementById('referralCode');

    if (refCode && refInput) {
        refInput.value = refCode.toUpperCase();
        refInput.readOnly = true;
        refInput.style.opacity = '0.7';
        console.log(`TOP: Referral code ${refCode} detected and locked.`);
    }
};

/**
 * --- REGISTRATION LOGIC ---
 */
export const handleRegistration = async (formData) => {
    const { fullName, username, email, phone, password, confirmPassword, referralCode } = formData;

    // 1. Client-side Validation
    if (password !== confirmPassword) {
        notify("Passwords do not match.", "error");
        return;
    }
    if (password.length < 6) {
        notify("Password must be at least 6 characters.", "warning");
        return;
    }

    toggleLoader(true, "Creating your account...");

    try {
        const result = await apiRegister({
            email,
            password,
            fullName,
            username,
            phone,
            refBy: referralCode || null
        });

        if (result.success) {
            notify(`Welcome to ${ENV.APP_NAME}! Account created successfully.`, "success");
            
            // Set flag for app.js to show Telegram Popup
            sessionStorage.setItem('just_logged_in', 'true');
            
            // Redirect to dashboard
            setTimeout(() => window.location.href = 'dashboard.html', 1500);
        } else {
            notify(result.error || "Registration failed.", "error");
            toggleLoader(false);
        }
    } catch (err) {
        notify("A network error occurred. Please try again.", "error");
        toggleLoader(false);
    }
};

/**
 * --- LOGIN LOGIC ---
 */
export const handleLogin = async (email, password) => {
    toggleLoader(true, "Authenticating...");

    try {
        const result = await apiLogin(email, password);

        if (result.success) {
            notify("Login successful. Welcome back!", "success");
            
            // Set flag for app.js to show Telegram Popup
            sessionStorage.setItem('just_logged_in', 'true');
            
            setTimeout(() => window.location.href = 'dashboard.html', 1000);
        } else {
            notify(result.error || "Invalid credentials.", "error");
            toggleLoader(false);
        }
    } catch (err) {
        notify("Connection failed. Check your internet.", "error");
        toggleLoader(false);
    }
};

/**
 * --- ADMINISTRATOR LOGIN ---
 */
export const handleAdminLogin = async (email, password) => {
    toggleLoader(true, "Verifying Admin Access...");

    try {
        const result = await apiAdminLogin(email, password);

        if (result.success) {
            notify("Admin access granted.", "success");
            setTimeout(() => window.location.href = 'index.html', 1000);
        } else {
            notify(result.error || "Access Denied.", "error");
            toggleLoader(false);
        }
    } catch (err) {
        notify("Admin authentication error.", "error");
        toggleLoader(false);
    }
};

/**
 * --- LOGOUT LOGIC ---
 */
export const handleLogout = async (isAdmin = false) => {
    toggleLoader(true, "Signing out...");
    try {
        await signOut();
        notify("Logged out successfully.", "info");
        
        // Redirect based on context
        setTimeout(() => {
            window.location.href = isAdmin ? 'login.html' : 'login.html';
        }, 800);
    } catch (err) {
        notify("Logout failed. Please refresh.", "error");
        toggleLoader(false);
    }
};

/**
 * --- UI HELPERS ---
 */

/**
 * Toggle password field visibility (Eye Icon logic)
 */
const setupPasswordVisibility = () => {
    const togglers = document.querySelectorAll('.password-toggle');
    togglers.forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const icon = btn.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });
};

/**
 * Validates password strength for registration
 * @param {string} password 
 * @returns {Object} { strength, color, message }
 */
export const getPasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;

    const map = [
        { label: 'Weak', color: '#ef4444' },
        { label: 'Fair', color: '#f59e0b' },
        { label: 'Good', color: '#3b82f6' },
        { label: 'Strong', color: '#10b981' },
        { label: 'Very Strong', color: '#059669' }
    ];

    return map[strength] || map[0];
};

/**
 * --- SESSION & PROTECTION ---
 */

/**
 * Protects a page by checking if the user is authenticated.
 * Used at the top of protected script modules.
 */
export const protectPage = async () => {
    const session = await getCurrentSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    return session.user;
};

/**
 * Protects Admin pages specifically.
 */
export const protectAdminPage = async () => {
    const session = await getCurrentSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    const user = session.user;

    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) {
        window.location.href = '../login.html';
        return null;
    }
    return user;
};
