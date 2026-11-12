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


# ─── Stage 2: Final Universal Image (Python + Nginx + Supervisor) ───
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Stream Python logs to supervisord immediately
ENV PYTHONUNBUFFERED=1

# Install Python backend dependencies
COPY backend/requirements_full.txt ./requirements.txt
# Install PyTorch CPU-only first for smaller image size
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Copy Backend and ML modules
COPY backend/ ./backend/
COPY ml/ ./ml/
COPY rag/ ./rag/
COPY models/ ./models/

# Pre-download ML models into Docker cache
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy Frontend Build from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend_dist

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

# Healthy only when nginx is up AND proxies to a running backend (/health is a FastAPI route).
# The start period covers loading torch, Silero VAD and the embedding model.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Run the entrypoint script
CMD ["/app/entrypoint.sh"]
