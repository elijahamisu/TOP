/**
 * TOP - Referral Management API
 * Handles referral link detection, relationship mapping, 
 * automated reward processing, and leaderboard analytics.
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
 * --- CORE REFERRAL LOGIC ---
 */

/**
 * Detect Referral Code from URL
 * Utility to be used on the registration page.
 * @returns {string|null}
 */
export const detectReferralCode = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('ref');
};

/**
 * Get User Referral Info
 * Returns the user's code and their unique sharing link.
 */
export const getUserReferralInfo = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('referral_code, username')
            .eq('id', userId)
            .single();

        if (error) throw error;

        const baseUrl = window.location.origin;
        return formatResponse(true, "Referral info retrieved.", {
            code: data.referral_code,
            link: `${baseUrl}/register.html?ref=${data.referral_code}`,
            username: data.username
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- REWARD PROCESSING ---
 */

/**
 * Process Referral Reward
 * Calculates reward based on Platform Settings and credits Referrer.
 * Typically triggered when a referred user makes their first successful deposit.
 * @param {string} referredUserId - The user who was invited.
 * @param {number} depositAmount - The amount they deposited.
 */
export const processReferralReward = async (referredUserId, depositAmount) => {
    try {
        // 1. Find the referral relationship
        const { data: referredProfile } = await supabase
            .from('profiles')
            .select('referral_by, full_name, username')
            .eq('id', referredUserId)
            .single();

        if (!referredProfile || !referredProfile.referral_by) {
            return formatResponse(true, "User was not referred. No reward to process.");
        }

        // 2. Identify Referrer
        const { data: referrer } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('referral_code', referredProfile.referral_by)
            .single();

        if (!referrer) throw new Error("Referrer no longer exists.");
        if (referrer.id === referredUserId) throw new Error("Self-referral detected and blocked.");

        // 3. Prevent Duplicate Rewards (Check if this specific referred user already generated a reward)
        const { data: existingReward } = await supabase
            .from('referrals')
            .select('id')
            .eq('referred_id', referredUserId)
            .eq('reward_status', 'paid')
            .maybeSingle();

        if (existingReward) return formatResponse(true, "Reward already paid for this referral.");

        // 4. Fetch Platform Settings for Commission Percentage
        const { data: settings } = await supabase
            .from('platform_settings')
            .select('referral_percent')
            .eq('id', 1)
            .single();

        const commissionPercent = parseFloat(settings?.referral_percent || 20);
        const rewardAmount = (commissionPercent / 100) * depositAmount;

        // 5. Update Referrer Wallet
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', referrer.id).single();
        const newBalance = parseFloat(wallet.balance) + rewardAmount;

        const { error: walletErr } = await supabase.from('wallets')
            .update({ balance: newBalance })
            .eq('user_id', referrer.id);
        
        if (walletErr) throw walletErr;

        // 6. Record Referral Transaction & Earning
        const { data: referralRecord } = await supabase.from('referrals').insert([{
            referrer_id: referrer.id,
            referred_id: referredUserId,
            reward_amount: rewardAmount,
            reward_percent: commissionPercent,
            reward_status: 'paid',
            reward_date: new Date().toISOString()
        }]).select().single();

        await supabase.from('transactions').insert([{
            user_id: referrer.id,
            amount: rewardAmount,
            type: 'referral',
            description: `Referral bonus from ${referredProfile.full_name}`,
            status: 'success',
            balance_after: newBalance
        }]);

        // 7. Notifications
        await supabase.from('notifications').insert([
            {
                user_id: referrer.id,
                title: 'Referral Bonus Received! 🎁',
                message: `You earned ₦${rewardAmount.toLocaleString()} because ${referredProfile.full_name} made an investment.`,
                type: 'referral'
            },
            {
                user_id: referredUserId,
                title: 'Referral Link Verified',
                message: `Your registration via referral has been processed. Thank you for joining our community.`,
                type: 'system'
            }
        ]);

        return formatResponse(true, "Referral reward processed successfully.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- DATA RETRIEVAL: STATS & HISTORY ---
 */

/**
 * Get user-specific referral stats
 */
export const getReferralStats = async (userId) => {
    try {
        const { data: profile } = await supabase.from('profiles').select('username').eq('id', userId).single();
        if (!profile) throw new Error('Profile not found');

        const [referrals, earnings] = await Promise.all([
            supabase.from('profiles').select('id', { count: 'exact' }).ilike('referral_by', profile.username),
            supabase.from('transactions').select('amount').eq('user_id', userId).eq('type', 'referral')
        ]);

        return formatResponse(true, "Stats retrieved.", {
            totalReferrals: referrals.count || 0,
            totalEarnings: earnings.data?.reduce((s, t) => s + parseFloat(t.amount), 0) || 0
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Get Global Leaderboard (Top 10)
 * Built from referral-type transactions, since that's what actually records
 * commission payouts (see admin/deposits.html's creditReferralCommission).
 */
export const getReferralLeaderboard = async () => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('user_id, amount, profiles:user_id(full_name, username)')
            .eq('type', 'referral');

        if (error) throw error;

        const leaderboard = data.reduce((acc, curr) => {
            const id = curr.user_id;
            if (!acc[id]) {
                acc[id] = {
                    name: curr.profiles.full_name,
                    username: curr.profiles.username,
                    count: 0,
                    totalEarned: 0
                };
            }
            acc[id].count += 1;
            acc[id].totalEarned += parseFloat(curr.amount);
            return acc;
        }, {});

        const sorted = Object.values(leaderboard)
            .sort((a, b) => b.totalEarned - a.totalEarned)
            .slice(0, 10);

        return formatResponse(true, "Leaderboard retrieved.", sorted);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN ACTIONS ---
 */

/**
 * Cancel a Referral Reward
 */
export const adminCancelReferralReward = async (referralId, reason) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        const { data, error } = await supabase
            .from('referrals')
            .update({ reward_status: 'cancelled', admin_note: reason })
            .eq('id', referralId)
            .select()
            .single();

        if (error) throw error;

        // Log Admin Action
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Cancelled Referral Reward #${referralId}. Reason: ${reason}`,
            target_id: referralId
        }]);

        return formatResponse(true, "Referral reward cancelled.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Real-time Subscription Channel
 */
export const REFERRAL_REALTIME = 'public:referrals';
