FROM python:3.12-slim

WORKDIR /app
COPY . /app

ENV HOST=0.0.0.0
ENV PORT=8765
ENV DATA_DIR=/data

EXPOSE 8765

CMD ["python", "server.py"]
