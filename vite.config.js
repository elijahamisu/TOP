import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

// Public Supabase defaults for the TOP project. The anon key is public by design (RLS protects data).
const DEFAULT_SUPABASE_URL = 'https://qeflimxlemgtjldoxtid.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlZmxpbXhsZW1ndGpsZG94dGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTQyNzIsImV4cCI6MjEwOTM5MDI3Mn0.wj7so8tKwMT6O1yXryfF293sbRj73KIzV1UmAuW3KaU';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const SUPABASE_URL = env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  return {
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(SUPABASE_ANON_KEY),
  },
  build: {
    rollupOptions: {
      input: {
        // Main User Pages
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        register: resolve(__dirname, 'register.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        plans: resolve(__dirname, 'plans.html'),
        investment: resolve(__dirname, 'investment.html'),
        wallet: resolve(__dirname, 'wallet.html'),
        deposit: resolve(__dirname, 'deposit.html'),
        withdraw: resolve(__dirname, 'withdraw.html'),
        earnings: resolve(__dirname, 'earnings.html'),
        transactions: resolve(__dirname, 'transactions.html'),
        referrals: resolve(__dirname, 'referrals.html'),
        notifications: resolve(__dirname, 'notifications.html'),
        profile: resolve(__dirname, 'profile.html'),
        support: resolve(__dirname, 'support.html'),
        terms: resolve(__dirname, 'terms.html'),
        giftcode: resolve(__dirname, 'giftcode.html'),

        // Admin Pages
        admin_dashboard: resolve(__dirname, 'admin/index.html'),
        admin_login: resolve(__dirname, 'admin/login.html'),
        admin_users: resolve(__dirname, 'admin/users.html'),
        admin_investments: resolve(__dirname, 'admin/investments.html'),
        admin_deposits: resolve(__dirname, 'admin/deposits.html'),
        admin_withdrawals: resolve(__dirname, 'admin/withdrawals.html'),
        admin_gateway: resolve(__dirname, 'admin/gateway.html'),
        admin_earnings: resolve(__dirname, 'admin/earnings.html'),
        admin_referrals: resolve(__dirname, 'admin/referrals.html'),
        admin_giftcodes: resolve(__dirname, 'admin/giftcodes.html'),
        admin_transactions: resolve(__dirname, 'admin/transactions.html'),
        admin_notifications: resolve(__dirname, 'admin/notifications.html'),
        admin_support: resolve(__dirname, 'admin/support.html'),
        admin_settings: resolve(__dirname, 'admin/settings.html'),
        admin_reports: resolve(__dirname, 'admin/reports.html'),
        admin_activity_log: resolve(__dirname, 'admin/activity-log.html'),
        admin_profile: resolve(__dirname, 'admin/profile.html'),
        admin_plans: resolve(__dirname, 'admin/plans.html'),
      },
    },
  },
};
});
