/**
 * TOP - Deposit Management API
 * Handles Kuda Bank deposit requests, validations, administrator approvals,
 * and automated wallet crediting.
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
 * --- HELPER: FETCH BANK DETAILS ---
 * Retrieves current Kuda Bank details from the Platform Settings table.
 */
export const getKudaBankDetails = async () => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('kuda_bank_name, kuda_account_name, kuda_account_number, deposit_instructions')
            .eq('id', 1)
            .single();

        if (error) throw error;
        return formatResponse(true, "Bank details retrieved.", data);
    } catch (err) {
        return formatResponse(false, "Could not load bank details.", null, err);
    }
};

/**
 * --- USER: CREATE DEPOSIT REQUEST ---
 */
export const createDepositRequest = async (amount, reference = "") => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required.");

        // 1. Validate User Account Status
        const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).single();
        if (profile?.status !== 'active') throw new Error("Your account is not active.");

        // 2. Validate Platform Settings (Minimum Deposit)
        const { data: settings } = await supabase.from('platform_settings').select('min_deposit_amount').eq('id', 1).single();
        const minAmount = parseFloat(settings?.min_deposit_amount || 1000);

        if (parseFloat(amount) < minAmount) {
            throw new Error(`The minimum deposit amount is ₦${minAmount.toLocaleString()}.`);
        }

        // 3. Create Request Record
        const { data: deposit, error } = await supabase.from('deposits').insert([{
            user_id: user.id,
            amount: parseFloat(amount),
            payment_method: 'Kuda Bank',
            payment_reference: reference,
            status: 'pending'
        }]).select().single();

        if (error) throw error;

        // 4. Notifications
        await supabase.from('notifications').insert([{
            user_id: user.id,
            title: 'Deposit Submitted',
            message: `Your deposit request of ₦${parseFloat(amount).toLocaleString()} has been received and is awaiting verification.`,
            type: 'deposit'
        }]);

        return formatResponse(true, "Deposit request submitted successfully.", deposit);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- USER: CANCEL PENDING DEPOSIT ---
 */
export const cancelDeposit = async (depositId) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: deposit } = await supabase.from('deposits').select('*').eq('id', depositId).eq('user_id', user.id).single();

        if (deposit.status !== 'pending') throw new Error("Only pending deposits can be cancelled.");

        await supabase.from('deposits').update({ status: 'cancelled' }).eq('id', depositId);
        
        return formatResponse(true, "Deposit request cancelled.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: APPROVE DEPOSIT ---
 * Credits the wallet, updates status, logs transaction and audit log.
 */
export const adminApproveDeposit = async (depositId) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        // 1. Fetch Deposit Details
        const { data: deposit } = await supabase.from('deposits').select('*').eq('id', depositId).single();
        if (!deposit || deposit.status !== 'pending') throw new Error("Deposit not found or already processed.");

        // 2. Fetch User Wallet
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', deposit.user_id).single();
        const oldBalance = parseFloat(wallet?.balance || 0);
        const newBalance = oldBalance + parseFloat(deposit.amount);

        // 3. Perform Updates (Atomic Logic)
        // Update Wallet
        await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', deposit.user_id);

        // Update Deposit Status
        await supabase.from('deposits').update({ 
            status: 'approved',
            processed_by: adminUser.id,
            processed_at: new Date().toISOString()
        }).eq('id', depositId);

        // Create Transaction Record
        await supabase.from('transactions').insert([{
            user_id: deposit.user_id,
            amount: deposit.amount,
            type: 'deposit',
            description: 'Kuda Bank Deposit Approved',
            status: 'success',
            balance_after: newBalance
        }]);

        // 4. Notify User
        await supabase.from('notifications').insert([{
            user_id: deposit.user_id,
            title: 'Deposit Approved ✅',
            message: `Your deposit of ₦${parseFloat(deposit.amount).toLocaleString()} has been confirmed. Your new balance is ₦${newBalance.toLocaleString()}.`,
            type: 'deposit'
        }]);

        // 5. Audit Log
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Approved Deposit #${depositId}`,
            target_id: deposit.user_id
        }]);

        return formatResponse(true, "Deposit approved and wallet credited.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMIN: REJECT DEPOSIT ---
 */
export const adminRejectDeposit = async (depositId, reason) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        const { data: deposit } = await supabase.from('deposits')
            .update({ 
                status: 'rejected', 
                rejection_reason: reason,
                processed_by: adminUser.id 
            })
            .eq('id', depositId)
            .select()
            .single();

        // Notify User
        await supabase.from('notifications').insert([{
            user_id: deposit.user_id,
            title: 'Deposit Rejected ❌',
            message: `Your deposit request was rejected. Reason: ${reason}`,
            type: 'deposit'
        }]);

        // Audit Log
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Rejected Deposit #${depositId}. Reason: ${reason}`,
            target_id: deposit.user_id
        }]);

        return formatResponse(true, "Deposit rejected.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- DATA RETRIEVAL: SUMMARIES ---
 */
export const getDepositStats = async (userId = null) => {
    try {
        let query = supabase.from('deposits').select('amount, status');
        if (userId) query = query.eq('user_id', userId);

        const { data } = await query;
        const approved = data.filter(d => d.status === 'approved');

        return formatResponse(true, "Stats loaded.", {
            totalCount: data.length,
            pendingCount: data.filter(d => d.status === 'pending').length,
            totalValue: approved.reduce((s, d) => s + parseFloat(d.amount), 0)
        });
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Real-time Subscription Channel
 */
export const DEPOSIT_REALTIME = 'public:deposits';
