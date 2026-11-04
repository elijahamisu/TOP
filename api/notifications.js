/**
 * TOP - Notifications API
 * Manages user alerts, administrative broadcasts, real-time synchronization,
 * and delivery statistics.
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
 * --- CORE NOTIFICATION FUNCTIONS ---
 */

/**
 * Create a new notification for a specific user.
 * Usually triggered by system events (Deposit, Withdrawal, Investment, etc.)
 */
export const createNotification = async (notifData) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .insert([{
                user_id: notifData.userId,
                title: notifData.title,
                message: notifData.message,
                type: notifData.type || 'system',
                priority: notifData.priority || 'normal',
                status: 'delivered',
                is_read: false
            }])
            .select()
            .single();

        if (error) throw error;
        return formatResponse(true, "Notification created successfully.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Get notifications for the currently logged-in user.
 * Supports filtering by read status or type.
 */
export const getUserNotifications = async (filters = {}) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required.");

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id);

        if (filters.unreadOnly) query = query.eq('is_read', false);
        if (filters.type && filters.type !== 'all') query = query.eq('type', filters.type);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        return formatResponse(true, "Notifications retrieved.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Mark a single notification as read.
 */
export const markAsRead = async (notificationId) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', notificationId);

        if (error) throw error;
        return formatResponse(true, "Notification marked as read.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Mark all notifications as read for the current user.
 */
export const markAllAsRead = async () => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('is_read', false);

        if (error) throw error;
        return formatResponse(true, "All notifications marked as read.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Delete a specific notification.
 */
export const deleteNotification = async (notificationId) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .delete()
            .eq('id', notificationId);

        if (error) throw error;
        return formatResponse(true, "Notification deleted.");
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- ADMINISTRATOR FUNCTIONS ---
 */

/**
 * Create a Broadcast Notification (Sends to all users).
 */
export const createBroadcastNotification = async (title, message, type = 'broadcast') => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        // Fetch all user IDs
        const { data: users, error: fetchErr } = await supabase.from('profiles').select('id');
        if (fetchErr) throw fetchErr;

        const notifications = users.map(u => ({
            user_id: u.id,
            title,
            message,
            type,
            status: 'delivered',
            created_by: adminUser.id
        }));

        const { error: insertErr } = await supabase.from('notifications').insert(notifications);
        if (insertErr) throw insertErr;

        // Log Admin Action
        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Sent Broadcast Notification: ${title}`
        }]);

        return formatResponse(true, `Broadcast sent to ${users.length} users.`);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * Schedule a notification for future delivery.
 */
export const scheduleNotification = async (notifData, scheduleTime) => {
    try {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        
        const { data, error } = await supabase
            .from('notifications')
            .insert([{
                user_id: notifData.userId,
                title: notifData.title,
                message: notifData.message,
                type: notifData.type || 'system',
                status: 'scheduled',
                scheduled_at: scheduleTime,
                created_by: adminUser.id
            }])
            .select()
            .single();

        if (error) throw error;

        await supabase.from('admin_logs').insert([{
            admin_id: adminUser.id,
            action: `Scheduled Notification for ${scheduleTime}`,
            target_id: data.id
        }]);

        return formatResponse(true, "Notification scheduled successfully.", data);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- STATISTICS ---
 */
export const getNotificationStats = async (userId = null) => {
    try {
        let query = supabase.from('notifications').select('id, is_read, type', { count: 'exact' });
        if (userId) query = query.eq('user_id', userId);

        const { data, count, error } = await query;
        if (error) throw error;

        const stats = {
            total: count,
            unread: data.filter(n => !n.is_read).length,
            read: data.filter(n => n.is_read).length,
            broadcasts: data.filter(n => n.type === 'broadcast').length
        };

        return formatResponse(true, "Stats retrieved.", stats);
    } catch (err) {
        return formatResponse(false, err.message);
    }
};

/**
 * --- REAL-TIME CHANNELS ---
 */
export const NOTIF_REALTIME = 'public:notifications';

/**
 * Example Usage for Frontend:
 * supabase.channel('notif-channel')
 *   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
 *      showToast(payload.new.title);
 *   })
 *   .subscribe();
 */
