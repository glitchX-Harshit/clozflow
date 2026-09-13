# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
# Inject environment variables for Vite build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build


# ─── Stage 2: Build WhatsApp Bridge dependencies ──────────────────────────────
FROM node:18-alpine AS bridge-builder
WORKDIR /app/whatsapp-bridge
COPY whatsapp-bridge/package*.json ./
RUN npm install --production
COPY whatsapp-bridge/ .


# ─── Stage 3: Final Universal Image (Python + Node.js + Nginx + Supervisor) ───
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libmagic1 \
    curl \
    nginx \
    supervisor \
    gettext-base \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python backend dependencies
COPY backend/requirements_full.txt ./requirements.txt
# Install PyTorch CPU-only first for smaller image size
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Copy Backend and ML modules
COPY backend/ ./backend/
COPY ml/ ./ml/
COPY rag/ ./rag/

# Copy Frontend Build from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend_dist

# Copy WhatsApp Bridge from Stage 2
COPY --from=bridge-builder /app/whatsapp-bridge ./whatsapp-bridge

# Copy Supervisor and Nginx configs
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY nginx.conf.template /app/nginx.conf.template
COPY entrypoint.sh /app/entrypoint.sh

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

# Render dynamically maps external requests to the port specified in PORT env var.
# Nginx will be configured to listen on this port via entrypoint.sh.
ENV PORT=8080
EXPOSE ${PORT}

# Run the entrypoint script
CMD ["/app/entrypoint.sh"]
