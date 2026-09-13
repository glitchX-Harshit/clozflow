#!/bin/sh
set -e

# Render provides the port in the PORT env var. Default to 8080 if not set.
export PORT="${PORT:-8080}"

# Substitute the PORT variable in the Nginx template
envsubst '${PORT}' < /app/nginx.conf.template > /etc/nginx/sites-available/default
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Remove default nginx html to be safe
rm -f /etc/nginx/sites-enabled/default.bak || true

# Start Supervisor which will start Nginx, Backend, and WhatsApp Bridge
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
