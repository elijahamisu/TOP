/**
 * TOP - Central Supabase Configuration
 * This file initializes the shared Supabase client and provides 
 * reusable helper functions for Auth, Storage, and Realtime.
 */

import { createClient } from '@supabase/supabase-js';

// 1. Environment Variable Validation
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
        "TOP Error: Supabase credentials are missing. " +
        "Please check your .env file and ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set."
    );
}

// 2. Initialize Singleton Client
// We export this client for direct use in complex queries.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * --- AUTHENTICATION HELPERS ---
 */

/**
 * Returns the currently authenticated user or null.
 */
export const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) return null;
    return user;
};

/**
 * Returns the current active session.
 */
export const getCurrentSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) return null;
    return session;
};

/**
 * Boolean check for active authentication.
 */
export const isAuthenticated = async () => {
    const user = await getCurrentUser();
    return !!user;
};

/**
 * Signs the user out and clears the local session.
 */
export const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error("Failed to sign out safely.");
    return true;
};

/**
 * --- STORAGE HELPERS ---
 */

/**
 * Uploads a file to a specific bucket.
 * Used for Profile Images and Payment Proofs.
 * @param {string} bucket - 'avatars' or 'payments'
 * @param {string} path - The folder/filename structure
 * @param {File} file - The file object from input
 */
export const uploadFile = async (bucket, path, file) => {
    try {
        const { data, error } = await supabase.storage
            .from(bucket)
            .upload(path, file, { upsert: true });

        if (error) throw error;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * Generates a public URL for a file in a public bucket.
 */
export const getFileUrl = (bucket, path) => {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
};

/**
 * Deletes a file from storage.
 */
export const deleteFile = async (bucket, path) => {
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) return { success: false, error: error.message };
    return { success: true, data };
};

/**
 * --- REALTIME HELPERS ---
 */

/**
 * Subscribe to specific table changes.
 * @param {string} channelName - Unique name for the subscription
 * @param {string} table - Table name to monitor
 * @param {string} event - 'INSERT', 'UPDATE', 'DELETE', or '*'
 * @param {Function} callback - Function to execute on change
 */
export const subscribeToTable = (channelName, table, event, callback) => {
    const channel = supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: event, schema: 'public', table: table },
            (payload) => callback(payload)
        )
        .subscribe();

    return channel;
};

/**
 * Safely removes a realtime subscription.
 */
export const unsubscribe = async (channel) => {
    if (channel) {
        await supabase.removeChannel(channel);
    }
};

/**
 * --- ERROR HANDLING UTILITY ---
 */

/**
 * Provides simple, user-friendly error messages based on Supabase codes.
 */
export const handleSupabaseError = (error) => {
    if (!error) return null;
    
    // Log for internal tracking
    console.warn("Supabase Operation Error:", error.message);

    // Return simple English for the UI
    if (error.message.includes("Invalid login credentials")) {
        return "Incorrect email or password. Please try again.";
    }
    if (error.message.includes("JWT")) {
        return "Your session has expired. Please login again.";
    }
    if (error.code === "23505") {
        return "This record already exists.";
    }
    
    return error.message || "An unexpected error occurred. Please try again.";
};

/**
 * --- USAGE EXAMPLES ---
 * 
 * 1. Auth check:
 *    import { isAuthenticated } from '../config/supabase';
 *    const ok = await isAuthenticated();
 * 
 * 2. Realtime:
 *    const mySub = subscribeToTable('notif-feed', 'notifications', 'INSERT', (payload) => {
 *        console.log('New Notif:', payload.new);
 *    });
 */
