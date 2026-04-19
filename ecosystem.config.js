// PM2 process config — used in production on the Hetzner VPS
module.exports = {
  apps: [
    {
      name: 'family-archive',
      script: 'dist/server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logs go to /var/log/family-archive/ on the VPS
      out_file: '/var/log/family-archive/out.log',
      error_file: '/var/log/family-archive/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
