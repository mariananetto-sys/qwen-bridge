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
CMD ["bash", "-lc", "rm -f /tmp/.X99-lock; Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; sleep 1; exec npm run server"]
