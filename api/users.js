/**
 * TOP - User Management API
 * Handles User Profiles, Wallet Summaries, Dashboard Aggregation, 
 * and Administrative User Controls.
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
 * --- USER PROFILE FUNCTIONS ---
 */

/**
 * Get the profile of the currently logged-in user.
 */
export const getCurrentProfile = async () => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated.");

        const { data, error } = await supabase
            .from('profiles')
            .select('*, wallets(balance)')
            .eq('id', user.id)
            .single();

        if (error) throw error;
        return formatResponse(true, "Profile retrieved.", data);
    } catch (err) {
        return formatResponse(false, err.message, null, err);
    }
};

/**
 * Update current user profile.
 * Only allows editing of: full_name, phone_number, and username.
 */
export const updateProfile = async (updates) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated.");

        // White-list allowed updates to prevent editing Member ID/Referral Code
        const allowedUpdates = {
            full_name: updates.full_name,
            phone: updates.phone,
            username: updates.username?.toLowerCase(),
            avatar_url: updates.avatar_url
        };

        const { data, error } = await supabase
            .from('profiles')
            .update(allowedUpdates)
            .eq('id', user.id)
            .select()
            .single();

        if (error) throw error;
        return formatResponse(true, "Profile updated successfully.", data);
    } catch (err) {
        return formatResponse(false, err.message, null, err);
    }
};

/**
 * Upload profile picture to Supabase Storage.
 */
export const uploadAvatar = async (file) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated.");

        const fileExt = file.name.split('.').pop();
        const fileName = `${user.id}-${Math.random()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('public')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('public').getPublicUrl(filePath);
        
        // Update profile with new URL
        await updateProfile({ avatar_url: publicUrl });

        return formatResponse(true, "Avatar uploaded.", { url: publicUrl });
    } catch (err) {
        return formatResponse(false, err.message, null, err);
    }
};

/**
 * --- WALLET & DASHBOARD FUNCTIONS ---
 */

/**
 * Retrieves all financial totals for the user's wallet view.
 */
export const getUserWalletStats = async (userId) => {
    try {
        const uid = userId || (await supabase.auth.getUser()).data.user?.id;
        
        const [wallet, txs, invs] = await Promise.all([
            supabase.from('wallets').select('balance').eq('user_id', uid).single(),
            supabase.from('transactions').select('amount, type').eq('user_id', uid).eq('status', 'success'),
            supabase.from('investments').select('amount, status').eq('user_id', uid)
        ]);

        const stats = {
            balance: wallet.data?.balance || 0,
            totalDeposits: txs.data.filter(t => t.type === 'deposit').reduce((a, b) => a + b.amount, 0),
            totalWithdrawals: txs.data.filter(t => t.type === 'withdrawal').reduce((a, b) => a + b.amount, 0),
            totalEarnings: txs.data.filter(t => t.type === 'earning').reduce((a, b) => a + b.amount, 0),
            totalReferralRewards: txs.data.filter(t => t.type === 'referral').reduce((a, b) => a + b.amount, 0),
            activeInvestments: invs.data.filter(i => i.status === 'active').reduce((a, b) => a + b.amount, 0)
        };

        return formatResponse(true, "Wallet stats retrieved.", stats);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Get comprehensive data for the main user dashboard.
 */
export const getUserDashboardData = async () => {
    try {
        const profile = await getCurrentProfile();
        const walletStats = await getUserWalletStats(profile.data.id);
        
        const { data: recentTxs } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', profile.data.id)
            .order('created_at', { ascending: false })
            .limit(5);

        const dashboard = {
            profile: profile.data,
            wallet: walletStats.data,
            recentTransactions: recentTxs || []
        };

        return formatResponse(true, "Dashboard data loaded.", dashboard);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- NOTIFICATION FUNCTIONS ---
 */

export const getUserNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    return error ? formatResponse(false, error.message) : formatResponse(true, "Notifications retrieved.", data);
};

export const markAllNotificationsRead = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id);
    return formatResponse(true, "All marked as read.");
};

/**
 * --- ADMINISTRATOR: USER MANAGEMENT ---
 */

/**
 * Admin: Get all users with search and filter capability.
 */
export const adminGetUsers = async (filters = {}) => {
    try {
        let query = supabase.from('profiles').select('*, wallets(balance)');

        if (filters.search) {
            query = query.or(`full_name.ilike.%${filters.search}%,username.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
        }
        if (filters.status && filters.status !== 'all') {
            query = query.eq('status', filters.status);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        return formatResponse(true, "Users retrieved.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Admin: Update a user's status (suspend/activate).
 */
export const adminSetUserStatus = async (userId, status) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .update({ status })
            .eq('id', userId);

        if (error) throw error;

        // Log Admin Action
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Set User Status to ${status}`,
            target_id: userId
        }]);

        return formatResponse(true, `User ${status} successfully.`);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Admin: Delete User (Permanent - Super Admin only).
 */
export const adminDeleteUser = async (userId) => {
    try {
        const { error } = await supabase.from('profiles').delete().eq('id', userId);
        if (error) throw error;
        return formatResponse(true, "User deleted permanently.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};
