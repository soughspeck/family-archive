import { registerRoutes, start } from './router.js'
import { init as initTimeline, destroy as destroyTimeline } from './timeline.js'
import { init as initDashboard, destroy as destroyDashboard } from './dashboard.js'

document.addEventListener('DOMContentLoaded', () => {
  registerRoutes([
    { path: '/',          init: initTimeline,  destroy: destroyTimeline },
    { path: '/timeline',  init: initTimeline,  destroy: destroyTimeline },
    { path: '/dashboard', init: initDashboard, destroy: destroyDashboard },
  ])

  start()
})
