FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
ENV QWEN_HEADLESS=true
ENV QWEN_STATE_DIR=/data
VOLUME ["/data"]
EXPOSE 3001
CMD ["npm", "run", "server"]
