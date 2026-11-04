/**
 * TOP - Authentication API
 * Handles User/Admin Registration, Login, Session Management, and Role Verification.
 * Integrates with Supabase Auth and Database.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration from Environment Variables
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BONUS_AMOUNT = 450; // Welcome Bonus (₦450)

// Initialize Supabase Client
export const supabase = createClient(SB_URL, SB_KEY);

/**
 * --- USER AUTHENTICATION ---
 */

/**
 * Register a new user
 * Performs Auth signup, creates Profile, Wallet, initial Transaction, and Notification.
 * @param {Object} data - { email, password, fullName, username, phone, refBy }
 */
export const registerUser = async ({ email, password, fullName, username, phone, refBy }) => {
    try {
        // 1. Supabase Auth Signup
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } }
        });

        if (authError) throw authError;
        const user = authData.user;

        if (user) {
            // 2. Generate Unique Referral Code (Format: EP-XXXXX)
            const refCode = `EP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            
            // 3. Create User Profile
            const { error: profileError } = await supabase.from('profiles').insert([{
                id: user.id,
                full_name: fullName,
                username: username.toLowerCase(),
                phone: phone,
                referral_code: refCode,
                referral_by: refBy || null, // Saves the code of the person who referred them
                status: 'active'
            }]);
            if (profileError) throw profileError;

            // 4. Initialize Wallet with ₦450 Welcome Bonus
            const { error: walletError } = await supabase.from('wallets').insert([{
                user_id: user.id,
                balance: BONUS_AMOUNT
            }]);
            if (walletError) throw walletError;

            // 5. Record Welcome Bonus Transaction
            await supabase.from('transactions').insert([{
                user_id: user.id,
                amount: BONUS_AMOUNT,
                type: 'bonus',
                description: 'Welcome Bonus Reward',
                status: 'success'
            }]);

            // 6. Create First Notification
            await supabase.from('notifications').insert([{
                user_id: user.id,
                title: 'Welcome to TOP!',
                message: `Congratulations ${fullName}! Your account is active and ₦${BONUS_AMOUNT} has been credited to your wallet as a welcome bonus.`,
                type: 'welcome'
            }]);

            return { success: true, message: "Registration successful!", user: authData.user };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Login User
 * @param {string} email 
 * @param {string} password 
 */
export const loginUser = async (email, password) => {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Fetch profile to verify status
        const { data: profile } = await supabase.from('profiles').select('status').eq('id', data.user.id).single();
        if (profile?.status === 'suspended') {
            await supabase.auth.signOut();
            throw new Error("Your account has been suspended. Please contact support.");
        }

        return { success: true, user: data.user, session: data.session };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * --- ADMINISTRATOR AUTHENTICATION ---
 */

/**
 * Login Administrator
 * Performs standard login and then verifies 'is_admin' flag in profiles table.
 */
export const loginAdmin = async (email, password) => {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Verify Admin Role
        const { data: profile, error: roleError } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', data.user.id)
            .single();

        if (roleError || !profile?.is_admin) {
            await supabase.auth.signOut();
            throw new Error("Access Denied: You do not have administrator privileges.");
        }

        // Log Admin Activity
        await supabase.from('admin_logs').insert([{
            admin_id: data.user.id,
            action: 'Admin Login',
            ip_address: 'Logged via UI'
        }]);

        return { success: true, user: data.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * --- SESSION MANAGEMENT ---
 */

/**
 * Verify current session and fetch associated profile/wallet data.
 */
export const verifySession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { authenticated: false };

    const { data: profile } = await supabase
        .from('profiles')
        .select('*, wallets(balance)')
        .eq('id', session.user.id)
        .single();

    return { 
        authenticated: true, 
        user: session.user, 
        profile,
        wallet: profile?.wallets || null 
    };
};

/**
 * Logout User or Admin
 */
export const logout = async () => {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Protect Admin Routes
 * Checks if the current session belongs to an admin.
 */
export const checkAdminAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .single();

    return data?.is_admin || false;
};
