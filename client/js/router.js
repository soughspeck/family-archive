// Simple hash-based router
let routes = [];
let currentRoute = null;
export function registerRoutes(r) {
    routes = r;
}
export function navigate(path) {
    if (window.location.hash === '#' + path) {
        // Same route — still re-trigger
        activateRoute(path);
    }
    else {
        window.location.hash = path;
    }
}
export function currentPath() {
    return window.location.hash.slice(1) || '/';
}
export function start() {
    window.addEventListener('hashchange', () => {
        activateRoute(currentPath());
    });
    activateRoute(currentPath());
}
async function activateRoute(path) {
    const route = routes.find(r => r.path === path) || routes.find(r => r.path === '/');
    if (!route)
        return;
    // Destroy previous view
    if (currentRoute && currentRoute !== route && currentRoute.destroy) {
        currentRoute.destroy();
    }
    currentRoute = route;
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        const linkPath = link.getAttribute('href')?.slice(1) || '/';
        link.classList.toggle('active', linkPath === route.path);
    });
    // Init new view
    try {
        await route.init();
    }
    catch (err) {
        console.error(`[router] Failed to init route "${path}":`, err);
        const app = document.getElementById('app');
        if (app)
            app.innerHTML = `<div class="state-empty"><h2>Something went wrong</h2><p>${err}</p></div>`;
    }
}
//# sourceMappingURL=router.js.map