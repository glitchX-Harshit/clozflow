FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir . && useradd --create-home brain
COPY configs ./configs
RUN mkdir -p /app/data && chown -R brain:brain /app
ENV CEB_ENGINES_CONFIG=/app/configs/engines.yaml
USER brain
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "clozflow_brain.api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
