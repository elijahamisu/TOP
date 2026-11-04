/**
 * TOP - Withdrawal Management API
 * Handles withdrawal requests, balance reservation, administrator approvals/rejections,
 * and automated wallet restoration upon rejection.
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
 * --- USER: CREATE WITHDRAWAL REQUEST ---
 * Reserves the wallet balance immediately to prevent double spending.
 */
export const createWithdrawalRequest = async (amount, bankDetails) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required.");

        // 1. Validate User Account Status
        const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).single();
        if (profile?.status !== 'active') throw new Error("Your account is not active.");

        // 2. Validate Amount
        const withdrawAmount = parseFloat(amount);
        if (withdrawAmount < 450) throw new Error("Minimum withdrawal is ₦450.");

        // 3. Check for existing pending requests (Limit to 1 pending to prevent spam)
        const { count: pendingCount } = await supabase
            .from('withdrawals')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'pending');
        
        if (pendingCount > 0) throw new Error("You already have a pending withdrawal request.");

        // 4. Validate Wallet Balance
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', user.id).single();
        const currentBalance = parseFloat(wallet?.balance || 0);

        if (currentBalance < withdrawAmount) {
            throw new Error("Insufficient wallet balance.");
        }

        // 5. Reservation Logic: Deduct balance immediately
        const newBalance = currentBalance - withdrawAmount;
        const { error: walletError } = await supabase.from('wallets')
            .update({ balance: newBalance })
            .eq('user_id', user.id);
        
        if (walletError) throw walletError;

        // 6. Create Withdrawal Record
        const { data: withdrawal, error: withdrawError } = await supabase.from('withdrawals').insert([{
            user_id: user.id,
            amount: withdrawAmount,
            bank_name: bankDetails.bankName,
            account_name: bankDetails.accountName,
            account_number: bankDetails.accountNumber,
            status: 'pending'
        }]).select().single();

        if (withdrawError) {
            // Rollback wallet if record fails
            await supabase.from('wallets').update({ balance: currentBalance }).eq('user_id', user.id);
            throw withdrawError;
        }

        // 7. Create Transaction Record (Status: Pending)
        await supabase.from('transactions').insert([{
            user_id: user.id,
            amount: withdrawAmount,
            type: 'withdrawal',
            description: `Withdrawal request to ${bankDetails.bankName}`,
            status: 'pending',
            balance_after: newBalance,
            reference_id: withdrawal.id
        }]);

        // 8. Notifications
        await supabase.from('notifications').insert([{
            user_id: user.id,
            title: 'Withdrawal Submitted',
            message: `Your request for ₦${withdrawAmount.toLocaleString()} has been received and is pending approval.`,
            type: 'withdrawal'
        }]);

        return formatResponse(true, "Withdrawal request submitted successfully.", withdrawal);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: APPROVE WITHDRAWAL ---
 */
export const adminApproveWithdrawal = async (withdrawalId) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        // 1. Fetch Request Details
        const { data: withdrawal } = await supabase.from('withdrawals').select('*').eq('id', withdrawalId).single();
        if (!withdrawal || withdrawal.status !== 'pending') throw new Error("Request not found or already processed.");

        // 2. Mark as Approved
        await supabase.from('withdrawals').update({ 
            status: 'approved',
            processed_by: adminUser.id,
            processed_at: new Date().toISOString()
        }).eq('id', withdrawalId);

        // 3. Update Transaction status
        await supabase.from('transactions')
            .update({ status: 'success' })
            .eq('reference_id', withdrawalId)
            .eq('type', 'withdrawal');

        // 4. Notify User
        await supabase.from('notifications').insert([{
            user_id: withdrawal.user_id,
            title: 'Withdrawal Approved ✅',
            message: `Your withdrawal of ₦${parseFloat(withdrawal.amount).toLocaleString()} has been approved and paid.`,
            type: 'withdrawal'
        }]);

        // 5. Audit Log
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Approved Withdrawal #${withdrawalId}`,
            target_id: withdrawal.user_id
        }]);

        return formatResponse(true, "Withdrawal approved and finalized.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: REJECT WITHDRAWAL ---
 * Restores the user's wallet balance.
 */
export const adminRejectWithdrawal = async (withdrawalId, reason) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        // 1. Fetch Request
        const { data: withdrawal } = await supabase.from('withdrawals').select('*').eq('id', withdrawalId).single();
        if (!withdrawal || withdrawal.status !== 'pending') throw new Error("Request not found.");

        // 2. Restore User Wallet
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', withdrawal.user_id).single();
        const currentBalance = parseFloat(wallet?.balance || 0);
        const restoredBalance = currentBalance + parseFloat(withdrawal.amount);

        await supabase.from('wallets').update({ balance: restoredBalance }).eq('user_id', withdrawal.user_id);

        // 3. Update Status
        await supabase.from('withdrawals').update({ 
            status: 'rejected', 
            rejection_reason: reason,
            processed_by: adminUser.id 
        }).eq('id', withdrawalId);

        // 4. Update Transaction
        await supabase.from('transactions')
            .update({ status: 'failed', description: `Withdrawal Rejected: ${reason}` })
            .eq('reference_id', withdrawalId);

        // 5. Notify User
        await supabase.from('notifications').insert([{
            user_id: withdrawal.user_id,
            title: 'Withdrawal Rejected ❌',
            message: `Your withdrawal request of ₦${parseFloat(withdrawal.amount).toLocaleString()} was rejected. Reason: ${reason}. Funds have been returned to your wallet.`,
            type: 'withdrawal'
        }]);

        // 6. Audit Log
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Rejected Withdrawal #${withdrawalId}. Reason: ${reason}`
        }]);

        return formatResponse(true, "Withdrawal rejected and balance restored.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- DATA RETRIEVAL ---
 */
export const getWithdrawalStats = async (userId = null) => {
    try {
        let query = supabase.from('withdrawals').select('amount, status');
        if (userId) query = query.eq('user_id', userId);

        const { data } = await query;
        const approved = data.filter(w => w.status === 'approved');

        return formatResponse(true, "Stats loaded.", {
            totalCount: data.length,
            pendingCount: data.filter(w => w.status === 'pending').length,
            totalValue: approved.reduce((s, w) => s + parseFloat(w.amount), 0)
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Real-time Subscription Channel
 */
export const WITHDRAWAL_REALTIME = 'public:withdrawals';
