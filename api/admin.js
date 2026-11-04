/**
 * TOP - Administrator API
 * Centralized logic for Admin Stats, Approvals, User Management, and Audit Logging.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SB_URL, SB_KEY);

/**
 * --- HELPER: VERIFY ADMIN ---
 * Ensures the requester is authenticated and has the 'Administrator' role.
 */
export const verifyAdmin = async () => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Unauthorized: No active session.");

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('is_admin, full_name')
            .eq('id', session.user.id)
            .single();

        if (error || !profile?.is_admin) throw new Error("Unauthorized: Administrator access required.");

        return { success: true, adminId: session.user.id, adminName: profile.full_name };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * --- HELPER: AUDIT LOG ---
 * Records every administrative action in the 'admin_logs' table.
 */
const createAuditLog = async (adminId, action, targetId = null) => {
    await supabase.from('admin_logs').insert([{
        admin_id: adminId,
        action: action,
        target_id: targetId,
        ip_address: 'System API',
        created_at: new Date().toISOString()
    }]);
};

/**
 * --- DASHBOARD STATISTICS ---
 * Fetches real-time counts and totals for the Admin Dashboard.
 */
export const getAdminStats = async () => {
    const auth = await verifyAdmin();
    if (!auth.success) return auth;

    try {
        const [
            users, 
            investments, 
            deposits, 
            withdrawals, 
            tickets,
            txVolume
        ] = await Promise.all([
            supabase.from('profiles').select('id, status', { count: 'exact' }),
            supabase.from('investments').select('amount, status'),
            supabase.from('deposits').select('amount, status'),
            supabase.from('withdrawals').select('amount, status'),
            supabase.from('support_tickets').select('id', { count: 'exact' }).eq('status', 'open'),
            supabase.from('transactions').select('amount')
        ]);

        const data = {
            totalUsers: users.count,
            activeUsers: users.data.filter(u => u.status === 'active').length,
            suspendedUsers: users.data.filter(u => u.status === 'suspended').length,
            totalInvestments: investments.data.length,
            activeInvestments: investments.data.filter(i => i.status === 'active').length,
            totalInvestedValue: investments.data.reduce((acc, curr) => acc + parseFloat(curr.amount), 0),
            pendingDeposits: deposits.data.filter(d => d.status === 'pending').length,
            totalDepositValue: deposits.data.filter(d => d.status === 'approved').reduce((acc, curr) => acc + parseFloat(curr.amount), 0),
            pendingWithdrawals: withdrawals.data.filter(w => w.status === 'pending').length,
            totalWithdrawalValue: withdrawals.data.filter(w => w.status === 'approved').reduce((acc, curr) => acc + parseFloat(curr.amount), 0),
            openTickets: tickets.count,
            platformTransactionVolume: txVolume.data.reduce((acc, curr) => acc + parseFloat(curr.amount), 0)
        };

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * --- DEPOSIT MANAGEMENT ---
 */
export const approveDeposit = async (depositId) => {
    const auth = await verifyAdmin();
    if (!auth.success) return auth;

    try {
        // 1. Get deposit info
        const { data: deposit } = await supabase.from('deposits').select('*').eq('id', depositId).single();
        if (deposit.status !== 'pending') throw new Error("Deposit is already processed.");

        // 2. Update wallet
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', deposit.user_id).single();
        const newBalance = parseFloat(wallet.balance) + parseFloat(deposit.amount);
        
        await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', deposit.user_id);
        
        // 3. Update deposit status
        await supabase.from('deposits').update({ status: 'approved' }).eq('id', depositId);

        // 4. Notifications & Logs
        await supabase.from('notifications').insert([{
            user_id: deposit.user_id,
            title: 'Deposit Approved',
            message: `Your deposit of ₦${parseFloat(deposit.amount).toLocaleString()} has been verified and added to your wallet.`,
            type: 'deposit'
        }]);

        await createAuditLog(auth.adminId, `Approved Deposit #${depositId}`, depositId);

        return { success: true, message: "Deposit approved successfully." };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * --- USER MANAGEMENT ---
 */
export const toggleUserAccess = async (userId, newStatus) => {
    const auth = await verifyAdmin();
    if (!auth.success) return auth;

    try {
        await supabase.from('profiles').update({ status: newStatus }).eq('id', userId);
        
        const actionLabel = newStatus === 'suspended' ? 'Suspended' : 'Activated';
        
        await supabase.from('notifications').insert([{
            user_id: userId,
            title: `Account ${actionLabel}`,
            message: `Your account has been ${newStatus} by the administrator.`,
            type: 'system'
        }]);

        await createAuditLog(auth.adminId, `${actionLabel} User Account #${userId}`, userId);

        return { success: true, message: `User ${newStatus} successfully.` };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * --- BROADCAST SYSTEM ---
 */
export const sendGlobalNotification = async (title, message, type = 'broadcast') => {
    const auth = await verifyAdmin();
    if (!auth.success) return auth;

    try {
        const { data: users } = await supabase.from('profiles').select('id');
        const notifications = users.map(u => ({
            user_id: u.id,
            title,
            message,
            type
        }));

        await supabase.from('notifications').insert(notifications);
        await createAuditLog(auth.adminId, `Sent Broadcast: ${title}`);

        return { success: true, message: "Broadcast sent to all users." };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * --- REAL-TIME SUBSCRIPTIONS ---
 * Exporting channel names for frontend consumption.
 */
export const ADMIN_REALTIME_CHANNELS = {
    DEPOSITS: 'public:deposits',
    WITHDRAWALS: 'public:withdrawals',
    USERS: 'public:profiles',
    TICKETS: 'public:support_tickets'
};
