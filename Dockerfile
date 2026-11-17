FROM node:22-slim
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    DATA_DIR=/data \
    VIEW_PORT=8080 \
    ADMIN_PORT=8081
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080 8081
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.VIEW_PORT+'/api/info').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
