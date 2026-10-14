# Always-on demo bot. Chromium + its system libraries come from the Playwright image (keep the tag in
# step with @playwright/test in package.json); ffmpeg comes from the ffmpeg-static dependency.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production OUTREACH_DIR=/data/outreach
VOLUME /data
EXPOSE 8787
CMD ["npm", "run", "bot"]
