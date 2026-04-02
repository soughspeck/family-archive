import { init as initTimeline } from './timeline.js';
import { init as initDashboard } from './dashboard.js';
// ─── Tab switching ────────────────────────────────────────────────────────────
function activateTab(tabName) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });
}
// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Wire tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            activateTab(tab);
        });
    });
    // Load timeline immediately (it's the main view)
    await initTimeline();
    // Load dashboard data in background
    initDashboard();
});
//# sourceMappingURL=main.js.map