/**
 * TOP - role tags (Admin, Promoter) shown beside a user's name.
 * roleTags(profile, { size: 'sm' | 'md' | 'lg' }) returns HTML ('' when the user has no role).
 */
export function roleTags(p, { size = 'sm' } = {}) {
    if (!p) return '';
    const tags = [];
    if (p.is_admin) tags.push(`<span class="role-tag role-admin role-${size}" title="Administrator"><i class="fas fa-shield-halved"></i><span>Admin</span></span>`);
    if (p.is_promoter) tags.push(`<span class="role-tag role-promoter role-${size}" title="Official TOP Promoter"><i class="fas fa-bullhorn"></i><span>Promoter</span></span>`);
    return tags.length ? `<span class="role-tags">${tags.join('')}</span>` : '';
}
