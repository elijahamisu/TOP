# TOP

**TOP** is a premium Nigerian Naira (NGN) investment platform designed for security, speed, and simplicity. Built with a mobile-first philosophy, the platform provides a luxury dark-themed interface for users to grow their wealth through automated daily earnings and a robust referral system.

The application uses **Vite** for a high-performance frontend, **Supabase** for real-time database management and authentication, and is optimized for seamless deployment on **Vercel**.

---

## 🚀 Features

### User Features
*   **Secure Authentication:** Quick registration and login (No KYC required).
*   **Personal Dashboard:** Real-time tracking of wallet balance, active investments, and earnings.
*   **Investment Plans:** Browse and subscribe to various Naira-based profit packages.
*   **Daily Earnings:** Profits are calculated and credited automatically at **12:00 AM (Africa/Lagos)**.
*   **Flexible Wallet:** Invest directly from your available balance or deposit via Kuda Bank.
*   **Kuda Bank Integration:** Exclusive, simplified deposit system using Kuda Bank.
*   **Referral Program:** Earn commissions by inviting friends using a unique referral link.
*   **Gift Codes:** Redeem promotional codes for instant wallet bonuses.
*   **Notifications:** Real-time alerts for every transaction, earning, and system update.
*   **Transaction History:** Detailed logs for all financial activities.

### Platform Features
*   **Welcome Bonus:** ₦500 credited automatically to all new users.
*   **Referral Rewards:** 20% commission on qualifying referral activities (Configurable).
*   **Mobile-First Design:** Optimized for a premium experience on smartphones.
*   **Supabase Realtime:** Instant UI updates without requiring page refreshes.

### Administrator Features
*   **Admin Console:** High-level overview of platform performance and statistics.
*   **User Management:** Activate, suspend, or ban accounts and view user profiles.
*   **Financial Approvals:** Review and process deposit and withdrawal requests.
*   **Investment Control:** Monitor active cycles and pause/resume earnings.
*   **Broadcast System:** Send notifications or announcements to the entire user base.
*   **System Settings:** Manage bank details, reward percentages, and maintenance mode.
*   **Audit Logs:** Permanent records of all administrative actions for security.

---

## 📂 Project Structure

```text
TOP/
├── admin/              # Administrator portal pages (Dashboard, Users, Finance)
├── api/                # Modular JavaScript logic for Supabase interactions
├── assets/             # Global CSS styles, page-specific JS, and images
├── config/             # Supabase initialization and environment configuration
├── public/             # Static assets (icons, manifest)
├── .env.example        # Template for environment variables
├── index.html          # Landing Page
├── dashboard.html      # Main User Interface
├── [other_pages].html  # Functional user pages (wallet, plans, etc.)
├── package.json        # Project dependencies and scripts
└── vite.config.js      # Multi-page build configuration
```

---

## 🛠️ Requirements

*   **Node.js:** version 20.x or higher
*   **npm:** Package manager (included with Node)
*   **Supabase:** A free or pro project for the backend
*   **Vercel:** Account for hosting and deployment
*   **Git:** For version control

---

## 🔧 Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/yourusername/top.git
    cd top
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Setup:**
    *   Copy `.env.example` to a new file named `.env`.
    *   Input your **Supabase URL** and **Anon Key**.
    *   Configure your Kuda Bank details and Telegram community link.

4.  **Start Development Server:**
    ```bash
    npm run dev
    ```

---

## 🔐 Environment Variables

The project requires the following keys to be set in your `.env` file or deployment dashboard:

| Variable | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Your unique Supabase Project URL. |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase Public API Key. |
| `VITE_APP_NAME` | TOP |
| `VITE_APP_TIMEZONE` | Africa/Lagos |
| `VITE_WELCOME_BONUS` | 500 |
| `VITE_KUDA_ACCOUNT_NUMBER`| Your registered Kuda account for deposits. |
| `VITE_TELEGRAM_GROUP` | Your community invitation link. |

---

## ☁️ Supabase Setup

The complete database definition is included at [`supabase/schema.sql`](supabase/schema.sql). Run this file in the Supabase SQL Editor to create the TOP schema, starter investment plans, platform settings, authentication trigger, transactional RPC functions, indexes, and Row Level Security policies.

Before enabling production traffic, replace the starter Kuda account details, review the welcome bonus and referral settings, and promote the first administrator by setting `profiles.is_admin = true` for the intended account.

1.  **Authentication:** Enable the Email provider in the Supabase Dashboard. Disable "Confirm Email" for a faster user experience if desired.
2.  **Database:** Create the necessary tables (`profiles`, `wallets`, `investments`, `transactions`, `deposits`, `withdrawals`, `notifications`, `platform_settings`, `admin_logs`).
3.  **Realtime:** Enable Replication for the tables you wish to track in real-time (e.g., `notifications`, `wallets`).
4.  **Storage:** Create a public bucket named `public` for profile avatars and payment proofs.

---

## 🚀 Deployment (Vercel)

This project is designed to be deployed on **Vercel** with zero configuration (`vercel.json` is not required).

1.  Push your code to a GitHub/GitLab repository.
2.  Import the project into Vercel.
3.  Add all environment variables from your `.env` file to the Vercel project settings.
4.  Click **Deploy**.

---

## 🛡️ Security

*   **No Hardcoded Secrets:** All credentials are managed via environment variables.
*   **RLS (Row Level Security):** Ensure RLS is enabled in Supabase so users can only access their own data.
*   **Admin Protection:** The admin module includes strict role-based verification.
*   **Input Validation:** All financial inputs are validated on both the client and server side.

---

## ❓ Troubleshooting

*   **404 on subpages:** Ensure `vite.config.js` includes all HTML files in the `rollupOptions.input` section.
*   **Balance not updating:** Verify that Supabase Realtime is enabled for the `wallets` table.
*   **Build Errors:** Ensure you are using Node.js version 20 or higher.

---

## 📜 License

This project is licensed under the **MIT License**.

---

## 📞 Support

For technical assistance or business inquiries, please visit the **Support Center** within the platform or contact us via our **Telegram Community**.

---
*© 2026 TOP. All Rights Reserved.*
