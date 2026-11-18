FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/start.mjs ./scripts/start.mjs
COPY --from=build /app/reports ./reports
COPY --from=build /app/data/noaa ./data/noaa
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
