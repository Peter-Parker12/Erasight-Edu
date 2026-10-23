FROM node:22-alpine

WORKDIR /app
COPY server.js *.html ./
COPY assets ./assets
COPY components ./components

ENV NODE_ENV=production PORT=4232
USER node
EXPOSE 4232
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4232/Homepage >/dev/null || exit 1

CMD ["node", "server.js"]
