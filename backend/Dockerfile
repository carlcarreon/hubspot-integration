FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY backend ./backend
COPY scripts ./scripts
# Prisma reads this during generation only. It is not copied into the runtime image.
ENV DATABASE_URL=postgresql://hubspot:hubspot@localhost:5432/hubspot_order_sync?schema=public
RUN npm run build --workspace @hubspot-order-sync/backend

FROM node:24-alpine AS runtime

RUN apk add --no-cache python3
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=build /app/scripts/export_deals.py ./scripts/export_deals.py

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/server.js"]
