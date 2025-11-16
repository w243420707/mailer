FROM python:3.10-slim
WORKDIR /app

# install system deps
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY . /app
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 6253

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:6253", "webapp.app:app"]
