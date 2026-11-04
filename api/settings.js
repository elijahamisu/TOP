/**
 * TOP - Platform Settings API
 * Manages global configurations, maintenance mode, financial limits,
 * and system-wide security policies.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration from Environment Variables
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SB_URL, SB_KEY);

/**
 * --- HELPER: RESPONSE HANDLER ---
 */
const formatResponse = (success, message, data = null, error = null) => ({
    success,
    message,
    data,
    error
});

/**
 * --- GET SETTINGS ---
 * Fetches the global platform configuration.
 * Accessible by both users (read-only) and admins.
 */
export const getPlatformSettings = async () => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('*')
            .eq('id', 1) // Platform uses a single-row configuration pattern
            .single();

        if (error) throw error;
        return formatResponse(true, "Settings retrieved successfully.", data);
    } catch (err) {
        return formatResponse(false, "Failed to load platform settings.", null, err);
    }
};

/**
 * --- UPDATE SETTINGS ---
 * Authorized Administrators only. Updates configuration and logs change.
 */
export const updatePlatformSettings = async (updates) => {
    try {
        // 1. Verify Admin Session
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase.from('profiles').select('is_admin, full_name').eq('id', user?.id).single();
        
        if (!profile?.is_admin) {
            return formatResponse(false, "Unauthorized: Administrator access required.");
        }

        // 2. Fetch Old Values for Audit Log
        const { data: oldSettings } = await supabase.from('platform_settings').select('*').eq('id', 1).single();

        // 3. Update Settings
        const { data, error } = await supabase
            .from('platform_settings')
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
                last_updated_by: user.id
            })
            .eq('id', 1)
            .select()
            .single();

        if (error) throw error;

        // 4. Create Audit Logs for each changed key
        const auditEntries = Object.keys(updates).map(key => ({
            admin_id: user.id,
            action: `Changed Setting: ${key}`,
            old_value: String(oldSettings[key]),
            new_value: String(updates[key]),
            category: 'settings'
        }));

        if (auditEntries.length > 0) {
            await supabase.from('admin_logs').insert(auditEntries);
        }

        return formatResponse(true, "Platform settings updated successfully.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- MAINTENANCE MODE CHECK ---
 * Utility for frontend route guards.
 */
export const isMaintenanceMode = async () => {
    const { data } = await supabase.from('platform_settings').select('maintenance_mode').eq('id', 1).single();
    return data?.maintenance_mode || false;
};

/**
 * --- RESET TO DEFAULTS ---
 * Super Admin only. Restores platform to factory configuration.
 */
export const resetPlatformSettings = async () => {
    const defaults = {
        app_name: "TOP",
        welcome_bonus_amount: 450,
        referral_percent: 20,
        min_withdrawal_amount: 450,
        min_investment_amount: 5000,
        daily_earnings_time: "00:00:00", // Africa/Lagos Midnight
        maintenance_mode: false,
        enable_withdrawals: true,
        enable_investments: true,
        kuda_bank_name: "Kuda Bank",
        deposit_instructions: "Transfer the exact amount to the account below."
    };

    return await updatePlatformSettings(defaults);
};

/**
 * --- BACKUP & EXPORT ---
 * Generates a JSON dump of current settings for recovery purposes.
 */
export const exportConfiguration = async () => {
    const settings = await getPlatformSettings();
    if (!settings.success) return settings;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings.data));
    return formatResponse(true, "Configuration ready for download.", { url: dataStr });
};

/**
 * --- REAL-TIME CHANNEL ---
 * Frontend components should subscribe to this to react to settings changes 
 * (e.g., immediate Maintenance Mode redirect).
 */
export const SETTINGS_REALTIME_CHANNEL = 'public:platform_settings';

/**
 * --- PERMISSION VALIDATION ---
 * Reusable helper for settings-related UI elements.
 */
export const canManageSettings = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
    return data?.is_admin || false;
};

/**
 * --- FINANCIAL VALIDATION HELPERS ---
 * These helpers use the current DB settings to validate transactions.
 */
export const validateWithdrawalAmount = async (amount) => {
    const { data } = await supabase.from('platform_settings').select('min_withdrawal_amount, enable_withdrawals').eq('id', 1).single();
    if (!data.enable_withdrawals) return { valid: false, error: "Withdrawals are currently disabled." };
    if (amount < data.min_withdrawal_amount) return { valid: false, error: `Minimum withdrawal is ₦${data.min_withdrawal_amount.toLocaleString()}.` };
    return { valid: true };
};

export const validateInvestmentAmount = async (amount) => {
    const { data } = await supabase.from('platform_settings').select('min_investment_amount, enable_investments').eq('id', 1).single();
    if (!data.enable_investments) return { valid: false, error: "New investments are currently disabled." };
    if (amount < data.min_investment_amount) return { valid: false, error: `Minimum investment is ₦${data.min_investment_amount.toLocaleString()}.` };
    return { valid: true };
};
