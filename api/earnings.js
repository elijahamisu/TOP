/**
 * TOP - Daily Earnings API
 * Manages the automated 12:00 AM (Africa/Lagos) profit distribution,
 * validation, scheduler monitoring, and earnings history.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SB_URL, SB_KEY);

/**
 * --- HELPER: GET LAGOS DATE ---
 * Ensures calculations follow Africa/Lagos time regardless of server location.
 */
const getLagosDateString = () => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
};

const formatResponse = (success, message, data = null, error = null) => ({
    success, message, data, error
});

/**
 * --- CORE ENGINE: PROCESS DAILY EARNINGS ---
 * Designed to be triggered by a CRON job at 12:00 AM Lagos time.
 */
export const processDailyEarnings = async () => {
    const today = getLagosDateString();
    let processedCount = 0;
    let failedCount = 0;
    let totalCredited = 0;

    try {
        // 1. Log Start of Process
        console.log(`[${today}] Starting Daily Earnings Distribution...`);

        // 2. Fetch Active Investments with User and Wallet status
        // Filters: Investment is 'active', User is 'active'
        const { data: investments, error: fetchErr } = await supabase
            .from('investments')
            .select(`
                *,
                profiles!inner(status),
                wallets!inner(balance)
            `)
            .eq('status', 'active')
            .eq('profiles.status', 'active');

        if (fetchErr) throw fetchErr;
        if (!investments || investments.length === 0) {
            return formatResponse(true, "No active investments to process today.");
        }

        // 3. Process each investment
        for (const inv of investments) {
            try {
                // a. Verify if already earned today (Duplicate Prevention)
                const { data: existing } = await supabase
                    .from('transactions')
                    .select('id')
                    .eq('investment_id', inv.id)
                    .eq('type', 'earning')
                    .gte('created_at', `${today}T00:00:00`)
                    .lte('created_at', `${today}T23:59:59`)
                    .maybeSingle();

                if (existing) continue; // Skip if already paid

                const profit = parseFloat(inv.daily_profit);
                const currentBalance = parseFloat(inv.wallets.balance);
                const newBalance = currentBalance + profit;

                // b. Execute Credit (Atomic-like updates)
                // Update Wallet
                const { error: wallErr } = await supabase
                    .from('wallets')
                    .update({ balance: newBalance })
                    .eq('user_id', inv.user_id);
                
                if (wallErr) throw wallErr;

                // Create Transaction Record
                await supabase.from('transactions').insert([{
                    user_id: inv.user_id,
                    investment_id: inv.id,
                    amount: profit,
                    type: 'earning',
                    description: `Daily profit: ${inv.plan_name}`,
                    status: 'success',
                    balance_after: newBalance
                }]);

                // Create Notification for User
                await supabase.from('notifications').insert([{
                    user_id: inv.user_id,
                    title: 'Daily Earnings Credited',
                    message: `Your account was credited with ₦${profit.toLocaleString()} profit from your ${inv.plan_name}.`,
                    type: 'earning'
                }]);

                // c. Check if investment is completed today
                if (new Date() >= new Date(inv.end_date)) {
                    await supabase.from('investments').update({ status: 'completed' }).eq('id', inv.id);
                    await supabase.from('notifications').insert([{
                        user_id: inv.user_id,
                        title: 'Investment Completed',
                        message: `Your ${inv.plan_name} has reached its end date and is now marked as completed.`,
                        type: 'system'
                    }]);
                }

                processedCount++;
                totalCredited += profit;

            } catch (itemErr) {
                console.error(`Failed to process investment ${inv.id}:`, itemErr.message);
                failedCount++;
                // Log failure to DB for Admin review
                await supabase.from('error_logs').insert([{
                    module: 'earnings',
                    reference_id: inv.id,
                    error_message: itemErr.message
                }]);
            }
        }

        // 4. Update Scheduler Log
        await supabase.from('scheduler_logs').insert([{
            run_date: today,
            status: failedCount === 0 ? 'success' : 'partial_success',
            processed_count: processedCount,
            failed_count: failedCount,
            total_amount: totalCredited
        }]);

        return formatResponse(true, "Earnings processing completed.", { 
            processed: processedCount, 
            failed: failedCount, 
            total: totalCredited 
        });

    } catch (globalErr) {
        return formatResponse(false, "Global earnings processing failed.", null, globalErr);
    }
};

/**
 * --- DATA RETRIEVAL: USER EARNINGS ---
 */
export const getUserEarningsHistory = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*, investments(plan_name)')
            .eq('user_id', userId)
            .eq('type', 'earning')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return formatResponse(true, "Earnings history retrieved.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- DATA RETRIEVAL: STATS ---
 */
export const getEarningsStats = async (userId = null) => {
    try {
        let query = supabase.from('transactions').select('amount, created_at').eq('type', 'earning');
        if (userId) query = query.eq('user_id', userId);

        const { data } = await query;
        if (!data) return formatResponse(true, "No data.", { total: 0 });

        const today = new Date().toDateString();
        const total = data.reduce((s, e) => s + parseFloat(e.amount), 0);
        const todayEarned = data.filter(e => new Date(e.created_at).toDateString() === today)
                                .reduce((s, e) => s + parseFloat(e.amount), 0);

        return formatResponse(true, "Stats loaded.", {
            totalEarnings: total,
            todayEarnings: todayEarned,
            count: data.length
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: MONITORING ---
 */
export const getSchedulerStatus = async () => {
    try {
        const { data, error } = await supabase
            .from('scheduler_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        // Calculate next run (12:00 AM Lagos)
        const nextRun = new Date();
        nextRun.setHours(24, 0, 0, 0);

        return formatResponse(true, "Status retrieved.", {
            lastRun: data,
            nextScheduledRun: nextRun.toISOString(),
            isHealthy: data.status === 'success'
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- REAL-TIME CHANNELS ---
 */
export const EARNINGS_REALTIME = 'public:transactions';
