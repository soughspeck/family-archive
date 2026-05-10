import { registerRoutes, start } from './router.js'
import { initMediaBaseUrl } from './api.js'
import { init as initTimeline, destroy as destroyTimeline } from './timeline.js'
import { init as initDashboard, destroy as destroyDashboard } from './dashboard.js'

document.addEventListener('DOMContentLoaded', async () => {
  // Fetch media base URL from server before any rendering — controls whether
  // images load from /uploads (dev) or the R2 CDN (prod).
  await initMediaBaseUrl()

  registerRoutes([
    { path: '/',          init: initTimeline,  destroy: destroyTimeline },
    { path: '/timeline',  init: initTimeline,  destroy: destroyTimeline },
    { path: '/dashboard', init: initDashboard, destroy: destroyDashboard },
  ])

  start()
})
