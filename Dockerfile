FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY netlify/functions/lib ./netlify/functions/lib
COPY worker ./worker
ENV NODE_ENV=production
CMD ["node", "worker/worker.mjs"]
