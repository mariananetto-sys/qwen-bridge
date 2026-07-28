FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx playwright install chrome
COPY . .

ENV NODE_ENV=production
ENV CHATGPT_HEADLESS=false
ENV CHATGPT_BROWSER_CHANNEL=chrome
ENV CHATGPT_STATE_DIR=/data
VOLUME ["/data"]
EXPOSE 3001
CMD ["xvfb-run", "-a", "npm", "run", "server"]
