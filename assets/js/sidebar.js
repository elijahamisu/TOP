/**
 * TOP - User sidebar with every user page.
 * Mobile: a menu button in the header opens a slide-in drawer (bottom nav stays).
 * Desktop (>=960px): the sidebar is always visible and replaces the short left rail.
 */
import { supabase } from '../../config/supabase.js';

const SECTIONS = [
    { title: 'Main', links: [
        ['dashboard.html', 'fas fa-th-large', 'Dashboard'],
        ['plans.html', 'fas fa-layer-group', 'Investment Plans'],
        ['investment.html', 'fas fa-chart-line', 'My Investments'],
        ['earnings.html', 'fas fa-coins', 'Earnings'],
    ]},
    { title: 'Money', links: [
        ['wallet.html', 'fas fa-wallet', 'Wallet'],
        ['deposit.html', 'fas fa-arrow-down', 'Deposit'],
        ['withdraw.html', 'fas fa-arrow-up', 'Withdraw'],
        ['transactions.html', 'fas fa-receipt', 'Transactions'],
    ]},
    { title: 'Rewards', links: [
        ['referrals.html', 'fas fa-user-friends', 'Referrals'],
        ['giftcode.html', 'fas fa-gift', 'Gift Code'],
    ]},
    { title: 'Account', links: [
        ['notifications.html', 'fas fa-bell', 'Notifications'],
        ['profile.html', 'fas fa-user-circle', 'Profile'],
        ['support.html', 'fas fa-headset', 'Support'],
        ['terms.html', 'fas fa-file-contract', 'Terms'],
    ]},
];

function currentPage() {
    const last = window.location.pathname.split('/').pop() || 'dashboard.html';
    return last.endsWith('.html') ? last : last + '.html';
}

function build() {
    if (!document.querySelector('.bottom-nav') || document.getElementById('userSidebar')) return;
    const page = currentPage();

    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop user-drawer-backdrop';

    const aside = document.createElement('aside');
    aside.id = 'userSidebar';
    aside.className = 'drawer user-sidebar';
    aside.setAttribute('aria-label', 'Main menu');
    aside.innerHTML = `
        <div class="user-sidebar-head">
            <a href="dashboard.html" class="user-sidebar-brand"><img src="assets/img/logo.svg" alt="TOP"></a>
            <button type="button" class="icon-btn user-sidebar-close" aria-label="Close menu"><i class="fas fa-times"></i></button>
        </div>
        ${SECTIONS.map(sec => `
            <p class="user-sidebar-label">${sec.title}</p>
            ${sec.links.map(([href, icon, label]) =>
                `<a href="${href}" class="side-link${href === page ? ' active' : ''}"><i class="${icon}"></i><span>${label}</span></a>`).join('')}
        `).join('')}
        <button type="button" class="side-link user-sidebar-logout"><i class="fas fa-sign-out-alt"></i><span>Log Out</span></button>
    `;

    document.body.append(backdrop, aside);

    const open = () => { aside.classList.add('is-open'); backdrop.classList.add('is-open'); };
    const close = () => { aside.classList.remove('is-open'); backdrop.classList.remove('is-open'); };
    backdrop.addEventListener('click', close);
    aside.querySelector('.user-sidebar-close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    aside.querySelector('.user-sidebar-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    // Menu button at the start of the header
    const headerInner = document.querySelector('.app-header-inner');
    if (headerInner) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn user-menu-btn';
        btn.setAttribute('aria-label', 'Open menu');
        btn.innerHTML = '<i class="fas fa-bars"></i>';
        btn.addEventListener('click', open);
        const first = headerInner.firstElementChild;
        if (first) {
            first.style.display = first.style.display || '';
            first.classList.add('has-menu-btn');
            first.prepend(btn);
        } else {
            headerInner.prepend(btn);
        }
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
