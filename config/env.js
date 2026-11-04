/**
 * TOP - Environment Configuration
 * This file serves as the single source of truth for all environment variables 
 * and provides global utility helpers for formatting and timezone management.
 */

// 1. Environment Variable Validation
const requiredEnvVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_APP_NAME',
    'VITE_APP_CURRENCY',
    'VITE_APP_TIMEZONE'
];

const validateEnv = () => {
    const missing = requiredEnvVars.filter(key => !import.meta.env[key]);
    if (missing.length > 0) {
        console.warn(
            `TOP Warning: Missing required environment variables: ${missing.join(', ')}. ` +
            `The platform may not function correctly until these are set in your .env file or Vercel dashboard.`
        );
        return false;
    }
    return true;
};

const isEnvValid = validateEnv();

// 2. Global Configuration Object
export const ENV = {
    // Supabase
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || null,
    SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || null,

    // Platform Identity
    APP_NAME: import.meta.env.VITE_APP_NAME || 'TOP',
    APP_URL: window.location.origin,

    // Financial Configuration
    CURRENCY_CODE: import.meta.env.VITE_APP_CURRENCY || 'NGN',
    CURRENCY_SYMBOL: '₦',
    WELCOME_BONUS: parseFloat(import.meta.env.VITE_WELCOME_BONUS) || 450,

    // Timezone Configuration
    TIMEZONE: import.meta.env.VITE_APP_TIMEZONE || 'Africa/Lagos',
    
    // Community
    TELEGRAM_LINK: import.meta.env.VITE_TELEGRAM_LINK || 'https://t.me/+jBbRS6HqIjM2YmM8',
    TELEGRAM_CHANNEL_LINK: import.meta.env.VITE_TELEGRAM_CHANNEL_LINK || 'https://t.me/monvexachannel',

    // Bank Details (Kuda)
    KUDA_NAME: import.meta.env.VITE_KUDA_ACCOUNT_NAME || 'TOP ADMIN',
    KUDA_NUMBER: import.meta.env.VITE_KUDA_ACCOUNT_NUMBER || '0000000000',
    KUDA_BANK: import.meta.env.VITE_KUDA_BANK_NAME || 'Kuda Bank'
};

/**
 * --- CURRENCY HELPERS ---
 */

/**
 * Formats a number into Nigerian Naira (₦).
 * Example: 5000 -> ₦5,000.00
 */
export const formatCurrency = (amount) => {
    const value = parseFloat(amount || 0);
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        currencyDisplay: 'symbol',
    }).format(value).replace('NGN', ENV.CURRENCY_SYMBOL);
};

/**
 * --- TIMEZONE & DATE HELPERS (Africa/Lagos) ---
 */

/**
 * Gets the current date/time specifically for the Lagos timezone.
 */
export const getLagosTime = () => {
    return new Date(new Date().toLocaleString('en-US', { timeZone: ENV.TIMEZONE }));
};

/**
 * Formats a date string into a readable format.
 * Example: Oct 24, 2024
 */
export const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: ENV.TIMEZONE
    });
};

/**
 * Formats a time string into 12-hour format.
 * Example: 12:00 AM
 */
export const formatTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: ENV.TIMEZONE
    });
};

/**
 * Combined Date and Time formatting.
 */
export const formatDateTime = (dateString) => {
    return `${formatDate(dateString)} at ${formatTime(dateString)}`;
};

/**
 * --- PLATFORM HELPERS ---
 */

export const getAppName = () => ENV.APP_NAME;
export const getCurrencySymbol = () => ENV.CURRENCY_SYMBOL;
export const getTimezone = () => ENV.TIMEZONE;

/**
 * --- USAGE EXAMPLES ---
 * 
 * import { formatCurrency, formatDateTime } from '../config/env';
 * 
 * console.log(formatCurrency(15000)); // ₦15,000.00
 * console.log(formatDateTime(new Date())); // 24 Oct, 2024 at 01:30 PM
 */
