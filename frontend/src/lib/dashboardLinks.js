/**
 * Dashboard deep links: `/dashboard?tab=<tab>&section=<section>`.
 *
 * `section` is a Pearl section when `tab=pearl` and a Settings panel when
 * `tab=settings`. Unknown values are ignored. Pure (no React) so it runs under
 * `node --test`.
 */

import { DEFAULT_PEARL_SECTION, PEARL_SECTIONS as PEARL_SECTION_REGISTRY } from '../pages/pearl/lib/subsectionNav.js';

export const DASHBOARD_TABS = ['overview', 'leads', 'history', 'relay', 'pearl', 'wizard', 'wallet', 'settings', 'analytics'];

export const DEFAULT_DASHBOARD_TAB = 'overview';

/** Pearl section ids come from the Pearl registry, so links follow its sidebar. */
export const PEARL_SECTIONS = PEARL_SECTION_REGISTRY.map((entry) => entry.id);

export { DEFAULT_PEARL_SECTION };

export const SETTINGS_PANELS = ['profile', 'workspace', 'ai', 'directives', 'notifications', 'security', 'billing', 'danger'];

export const DEFAULT_SETTINGS_PANEL = 'profile';

const SECTIONS_BY_TAB = { pearl: PEARL_SECTIONS, settings: SETTINGS_PANELS };

/** `{ tab, section }` from a query string; each is null when absent or unknown. */
export function parseDashboardSearch(search) {
    let params;
    try {
        params = new URLSearchParams(typeof search === 'string' ? search : '');
    } catch {
        return { tab: null, section: null };
    }
    const rawTab = (params.get('tab') || '').trim().toLowerCase();
    const tab = DASHBOARD_TABS.includes(rawTab) ? rawTab : null;
    const rawSection = (params.get('section') || '').trim().toLowerCase();
    const allowed = tab ? SECTIONS_BY_TAB[tab] : null;
    const section = allowed && allowed.includes(rawSection) ? rawSection : null;
    return { tab, section };
}

/** Query string for a tab (+ optional section); '' for the default Overview. */
export function buildDashboardSearch(tab, section) {
    if (!tab || !DASHBOARD_TABS.includes(tab) || tab === DEFAULT_DASHBOARD_TAB) return '';
    const params = new URLSearchParams({ tab });
    const allowed = SECTIONS_BY_TAB[tab];
    if (allowed && section && allowed.includes(section)) params.set('section', section);
    return `?${params.toString()}`;
}

/**
 * Where to go after sign-in: the protected page the user was sent away from
 * (ProtectedRoute passes it as `state.from`), else `fallback`. Only same-app
 * paths are honoured, never the auth screens themselves.
 */
export function safeRedirectPath(from, fallback) {
    let path = '';
    if (typeof from === 'string') path = from;
    else if (from && typeof from === 'object' && typeof from.pathname === 'string') {
        path = `${from.pathname}${from.search || ''}${from.hash || ''}`;
    }
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
    if (path === '/' || path.startsWith('/auth')) return fallback;
    return path;
}

/** True when the server refused a request for lack of wallet credits (HTTP 402): offer the wallet. */
export function needsWalletTopUp(err) {
    return Boolean(err) && typeof err === 'object' && err.status === 402;
}

/** Window event the Dashboard listens to; dispatch it to jump to Wallet & Billing (e.g. after a 402). */
export const OPEN_WALLET_EVENT = 'open-wallet-tab';

export function openWalletTab() {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(OPEN_WALLET_EVENT));
        }
    } catch {
        // Best effort only.
    }
}
