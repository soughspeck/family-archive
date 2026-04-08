// Simple hash-based router

export interface Route {
  path: string
  init: () => Promise<void> | void
  destroy?: () => void
}

let routes: Route[] = []
let currentRoute: Route | null = null

export function registerRoutes(r: Route[]): void {
  routes = r
}

export function navigate(path: string): void {
  if (window.location.hash === '#' + path) {
    // Same route — still re-trigger
    activateRoute(path)
  } else {
    window.location.hash = path
  }
}

export function currentPath(): string {
  return window.location.hash.slice(1) || '/'
}

export function start(): void {
  window.addEventListener('hashchange', () => {
    activateRoute(currentPath())
  })
  activateRoute(currentPath())
}

async function activateRoute(path: string): Promise<void> {
  const route = routes.find(r => r.path === path) || routes.find(r => r.path === '/')
  if (!route) return

  // Destroy previous view
  if (currentRoute && currentRoute !== route && currentRoute.destroy) {
    currentRoute.destroy()
  }

  currentRoute = route

  // Update nav links
  document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach(link => {
    const linkPath = link.getAttribute('href')?.slice(1) || '/'
    link.classList.toggle('active', linkPath === route.path)
  })

  // Init new view
  try {
    await route.init()
  } catch (err) {
    console.error(`[router] Failed to init route "${path}":`, err)
    const app = document.getElementById('app')
    if (app) app.innerHTML = `<div class="state-empty"><h2>Something went wrong</h2><p>${err}</p></div>`
  }
}
