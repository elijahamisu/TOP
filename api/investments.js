/**
 * TOP - Investment Management API
 * Handles creation, validation, daily earnings distribution, 
 * lifecycle updates, and real-time synchronization.
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
 * --- USER: CREATE INVESTMENT ---
 * Validates balance and limits, deducts from wallet, and creates records.
 */
export const createInvestment = async (planData) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required.");

        // 1. Validate User Account Status
        const { data: profile } = await supabase.from('profiles').select('status, username').eq('id', user.id).single();
        if (profile?.status !== 'active') throw new Error("Account is not active. Please contact support.");

        // 2. Validate Wallet Balance
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', user.id).single();
        const currentBalance = parseFloat(wallet?.balance || 0);
        const investAmount = parseFloat(planData.amount);

        if (currentBalance < investAmount) {
            throw new Error(`Insufficient wallet balance. You need ₦${(investAmount - currentBalance).toLocaleString()} more.`);
        }

        // 3. Plan Limits Validation
        if (investAmount < planData.minLimit || investAmount > planData.maxLimit) {
            throw new Error(`Amount must be between ₦${planData.minLimit.toLocaleString()} and ₦${planData.maxLimit.toLocaleString()}.`);
        }

        // 4. Calculate Dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + parseInt(planData.duration));

        // 5. Deduct from Wallet
        const { error: walletError } = await supabase.from('wallets')
            .update({ balance: currentBalance - investAmount })
            .eq('user_id', user.id);
        if (walletError) throw walletError;

        // 6. Create Investment Record
        const { data: investment, error: invError } = await supabase.from('investments').insert([{
            user_id: user.id,
            plan_name: planData.planName,
            amount: investAmount,
            daily_profit: planData.dailyProfit,
            profit_percent: planData.profitPercent,
            duration: planData.duration,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            status: 'active'
        }]).select().single();
        if (invError) throw invError;

        // 7. Record Transaction
        await supabase.from('transactions').insert([{
            user_id: user.id,
            amount: investAmount,
            type: 'investment',
            description: `Invested in ${planData.planName}`,
            status: 'success',
            balance_after: currentBalance - investAmount
        }]);

        // 8. Create Notification
        await supabase.from('notifications').insert([{
            user_id: user.id,
            title: 'Investment Successful',
            message: `Your investment of ₦${investAmount.toLocaleString()} in the ${planData.planName} is now active.`,
            type: 'investment'
        }]);

        return formatResponse(true, "Investment created successfully!", investment);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- SYSTEM: DAILY EARNINGS ENGINE ---
 * Logic intended to run at 12:00 AM Africa/Lagos.
 * Process: Active Invs -> Credit Wallet -> Log Earning -> Notify.
 */
export const distributeDailyEarnings = async () => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Current date YYYY-MM-DD

        // 1. Fetch all active investments
        const { data: activeInvs } = await supabase.from('investments').select('*').eq('status', 'active');
        if (!activeInvs || activeInvs.length === 0) return formatResponse(true, "No active investments to process.");

        for (const inv of activeInvs) {
            // 2. Prevent duplicate earnings for today
            const { data: exists } = await supabase.from('transactions')
                .select('id')
                .eq('user_id', inv.user_id)
                .eq('type', 'earning')
                .eq('created_at', today) // Simplified check; usually uses a dedicated 'earnings' table with date unique constraint
                .limit(1);

            if (exists && exists.length > 0) continue;

            // 3. Credit User Wallet
            const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', inv.user_id).single();
            const newBalance = parseFloat(wallet.balance) + parseFloat(inv.daily_profit);
            
            await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', inv.user_id);

            // 4. Record Transaction & Notification
            await supabase.from('transactions').insert([{
                user_id: inv.user_id,
                amount: inv.daily_profit,
                type: 'earning',
                description: `Daily profit from ${inv.plan_name}`,
                status: 'success'
            }]);

            await supabase.from('notifications').insert([{
                user_id: inv.user_id,
                title: 'Daily Earnings Credited',
                message: `₦${parseFloat(inv.daily_profit).toLocaleString()} profit added to your wallet from ${inv.plan_name}.`,
                type: 'earning'
            }]);

            // 5. Check if Investment is complete (Today is end_date)
            if (new Date() >= new Date(inv.end_date)) {
                await supabase.from('investments').update({ status: 'completed' }).eq('id', inv.id);
                await supabase.from('notifications').insert([{
                    user_id: inv.user_id,
                    title: 'Investment Completed',
                    message: `Your investment in ${inv.plan_name} has reached maturity and is now completed.`,
                    type: 'investment'
                }]);
            }
        }
        return formatResponse(true, "Daily earnings processed successfully.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: LIFECYCLE CONTROLS ---
 */

export const adminUpdateInvestmentStatus = async (investmentId, newStatus) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        const { data, error } = await supabase.from('investments')
            .update({ status: newStatus })
            .eq('id', investmentId)
            .select()
            .single();

        if (error) throw error;

        // Log Admin Action
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Set Investment status to ${newStatus}`,
            target_id: investmentId
        }]);

        // Notify User
        await supabase.from('notifications').insert([{
            user_id: data.user_id,
            title: `Investment ${newStatus.toUpperCase()}`,
            message: `Your investment #${investmentId.slice(0,8)} status has been changed to ${newStatus} by the administrator.`,
            type: 'system'
        }]);

        return formatResponse(true, `Investment ${newStatus} successfully.`);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- DATA RETRIEVAL: STATS & LISTS ---
 */

export const getInvestmentStats = async () => {
    try {
        const { data: all } = await supabase.from('investments').select('amount, status');
        const active = all.filter(i => i.status === 'active');
        
        const stats = {
            totalInvestments: all.length,
            activeInvestments: active.length,
            completedInvestments: all.filter(i => i.status === 'completed').length,
            totalInvestedAmount: all.reduce((s, i) => s + parseFloat(i.amount), 0),
            averageInvestment: all.length > 0 ? (all.reduce((s, i) => s + parseFloat(i.amount), 0) / all.length) : 0
        };

        return formatResponse(true, "Stats retrieved.", stats);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Real-time Subscription Channel
 */
export const INV_REALTIME = 'public:investments';
