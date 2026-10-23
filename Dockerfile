FROM node:22-alpine

WORKDIR /app
COPY server.js documents.js showcases.js *.html ./
COPY assets ./assets
COPY components ./components

# Uploaded documents + metadata live here (mounted as a volume in docker-compose.yml)
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production PORT=4232 DATA_DIR=/app/data
USER node
EXPOSE 4232
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4232/Homepage >/dev/null || exit 1

CMD ["node", "server.js"]
