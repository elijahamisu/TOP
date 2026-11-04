# TOP design system: "Crimson & Ivory"

Premium red and white theme. One stylesheet, `assets/css/top.css`, holds everything. The full class index is the comment at the top of that file. These notes explain how to use it.

## Brand

| Asset | Use |
|---|---|
| `assets/img/logo.svg` | Mark + "TOP" wordmark, for white backgrounds (nav, rail) |
| `assets/img/logo-white.svg` | The same in white, for red or dark backgrounds (footer, hero cards) |
| `assets/img/logo-mark.svg` | Mark only (auth card header, app icon spots) |
| `assets/img/favicon.svg` | Favicon: `<link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">` |

The mark is a red-gradient tile holding a white "T" whose crossbar is an upward chevron (growth), with a fine inner keyline. The wordmark is drawn as paths, so it never depends on a font. The "O" carries a red centre point.

**Fonts:** *Playfair Display* (600/700/800 + italic 600) for display headings and money figures, and *Inter* (400–800) for UI and body text. top.css `@import`s both, so a page only needs `top.css`. The converted pages also preload them with a `<link>`.

**Palette tokens:** `--red #E60000`, `--red-deep #B80000`, `--red-dark #8F0000`, `--red-bright #FF1717`, `--white`, `--red-50 #FFF5F5`, `--ink #171717`, `--ink-2 #777777`, `--line` (thin red outline), `--grad-red`, `--shadow-sm|md|lg|red`. Old variable names (`--accent-color`, `--text-muted`, `--success`, `--danger`, `--card-bg`, …) are aliased to the new palette, so JS that writes `style="color:var(--success)"` keeps working.

**Rules of thumb**
- White page, white `.card`s with a thin red outline for content. Use a red gradient (`.card-hero`, `.btn-primary`, `.stat-card.is-hero`, `.badge-solid`) only for the one or two things that matter most on a screen.
- Headings: `h1`/`h2` are Playfair automatically. Use `<em>` inside them for a red italic accent word.
- Money: wrap it in `.stat-value` / `.balance-amount` (Playfair, lining tabular numerals).
- Don't add one-off colours. Telegram buttons are `.btn-primary` / `.btn-outline`, not Telegram blue.

## Head template (every page)

```html
<link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>   <!-- if the page used it -->
<link rel="stylesheet" href="assets/css/top.css">
<meta name="theme-color" content="#E60000">
<style>/* only small page-specific rules, using the tokens */</style>
```
(Admin pages use `../assets/...`.)

## App page shell (user pages, step 2). Reference: `dashboard.html`

```html
<body class="app-body">
  <header class="app-header">
    <div class="container app-header-inner">
      <!-- dashboard: .user-chip with .avatar + .hello; other pages: -->
      <div class="row-between" style="gap:12px">
        <a href="dashboard.html" class="back-btn"><i class="fas fa-arrow-left"></i></a>
        <div><h1 class="page-title">Wallet</h1></div>
      </div>
      <div class="header-actions"><a class="icon-btn" href="notifications.html"><i class="fas fa-bell"></i></a></div>
    </div>
  </header>

  <main class="container app-main">          <!-- direct children get 24px rhythm -->
    <section class="card-hero"> … </section>  <!-- hero/balance: .balance-label .balance-amount .balance-split > .split-item -->
    <section class="grid grid-2c grid-4"> <div class="stat-card"><span class="stat-icon"><i class="fas fa-…"></i></span><h3 class="stat-value" id="…">0</h3><p class="stat-label">…</p></div> … </section>
    <section>
      <div class="section-head"><h3>Recent</h3><a class="view-all" href="…">See all</a></div>
      <div class="card"> … form or list … </div>
    </section>
  </main>

  <nav class="bottom-nav">                    <!-- fixed bottom bar on phones; left rail >= 960px -->
    <a href="dashboard.html" class="rail-brand"><img src="assets/img/logo.svg" alt="TOP"></a>
    <a href="dashboard.html" class="nav-item active"><i class="fas fa-th-large"></i><span>Home</span></a>
    <a href="plans.html" class="nav-item"><i class="fas fa-layer-group"></i><span>Plans</span></a>
    <a href="wallet.html" class="nav-item"><i class="fas fa-wallet"></i><span>Wallet</span></a>
    <a href="notifications.html" class="nav-item"><i class="fas fa-bell"></i><span>Alerts</span></a>
    <a href="profile.html" class="nav-item"><i class="fas fa-user-circle"></i><span>Profile</span></a>
  </nav>
</body>
```
- `.split-2` puts two blocks side by side (7/5) from 1100px. `.grid-2c` stays 2 columns even on phones. `.grid-2/3/4` stack to 1 column on phones.
- Rows (transactions, investments, notifications): `.list-item` with `.li-icon`, `.li-body > .li-title + .li-sub`, `.li-end`. JS that renders `.investment-card / .inv-info / .inv-badge` is already styled the same way.
- Quick actions: `.quick-actions > a.action-item > .action-icon + span` (5 columns), ideally inside a `.card`.

## Components cheat-sheet
- **Buttons:** `.btn` + `.btn-primary` (red gradient) | `.btn-outline` | `.btn-ghost` | `.btn-white` (on red) | `.btn-on-red` | `.btn-dark`. Sizes: `.btn-sm`, `.btn-lg`. Use `.btn-block` for full width. For a loading state, put `.spinner` inside the button; JS toggles its `display`. Square icon button: `.icon-btn` (use `.icon-btn-red` for the filled version).
- **Forms:** `.form-group > label + .input-wrapper > i + input.form-control`. `.form-grid` gives 2 columns from 640px, with `.full-width` spanning both. Add `.form-hint` / `.form-error` under a field. `select.form-control` gets a red chevron.
- **Tables:** `<div class="table-wrap"><table class="table table-stack">` and add `data-label="Amount"` to each `<td>`. Under 720px, each row becomes a stacked card. If JS builds the rows, add `data-label` in the template string; that is markup, not logic. Without `.table-stack`, add `.scroll` to `.table-wrap` to scroll sideways instead.
- **Badges:** `.badge` + `-red|-solid|-success|-warning|-danger|-muted|-white`.
- **Alerts:** `.alert` + `-error|-success|-info|-warning` (`.msg-error/.msg-success` still work).
- **Modal:** `.modal-overlay#id > .modal-card` (first `<i>` becomes a red icon tile, `.modal-btns` stacks the buttons). Hidden by default. JS `style.display='flex'` or `.is-open` shows it. It's a bottom sheet on phones and centred from 640px.
- **Empty / loading:** `.empty-state` (an `<i>` inside), `.skeleton`.
- **Page furniture:** `.page-header`, `.back-btn`, `.page-title`, `.page-sub`, `.section-head`, `.view-all`, `.divider`.
- **Public pages:** `.topnav > .container.topnav-inner` (`.brand`, `.topnav-links`, `.topnav-cta`, `details.menu-drop` for a JS-free mobile menu), `.site-footer(.dark)`, `.section`, `.section-tint`, `.section-title` (index inline), `.feature-card`, `.plan-card(.is-featured)`, `.step-card`, `.faq-item`.
- **Auth:** `.auth-shell > .container > .auth-card(.wide) > .auth-head(img + h1 + p)`, `.auth-foot`, `.trust-row`.
- **Admin (step 3):** `.sidebar` / `.drawer` slide in with `.is-open` (`.active` / `.open` also work for existing JS). `.drawer-backdrop`. Links: `.side-link(.active)`, group labels `.side-label`. From 1024px, use `.sidebar.is-static` + `<main class="with-sidebar">` for a fixed sidebar. Use `.table-wrap/.table-stack` for data and `.stat-card` for KPIs.
- **Motion:** `.fade-up` with `.d1`–`.d4` stagger and `.lift` hover. All of it is disabled under `prefers-reduced-motion`.

## Converting a page (steps 2 and 3)
1. Leave every `<script>`, element `id`, `name`, `onclick` and the class names JS queries (`querySelector('.x')`, `className = 'x'`) unchanged. Change markup and classes around them only. Before you commit, diff the script blocks against `HEAD` (they must be byte-identical) and compare the id sets.
2. Swap the `<head>` for the template above and delete the old `:root` + dark inline `<style>`. Keep only small layout rules that the system lacks.
3. Wrap the page in the app shell, then map old blocks to components: wallet/summary → `.card-hero`, metrics → `.stat-card`, panels/forms → `.card`, lists → `.list-item`, tables → `.table-stack`.
4. Remove hard-coded colours from inline `style=""` attributes (blues, greens, gold, `#229ED9`). Use tokens or utility classes (`.text-success`, `.text-danger`, `.muted`).
5. Check at 390px and 1280px: no horizontal scroll, no clipped numbers, and the bottom nav doesn't cover content.

`top.css` ends with a small **legacy bridge** (`.glass-card`, `.btn-gold`, `.text-gold`, …) that keeps unconverted pages readable on the new white theme. Delete it once steps 2 and 3 are done.
