# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- Dependencies ----
# Cached separately so installs only re-run when manifests change.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Development ----
# Used by docker-compose. Source is bind-mounted, so `start:dev`
# hot-reloads on changes.
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "start:dev"]

# ---- Build ----
FROM deps AS build
COPY . .
RUN pnpm run build && pnpm prune --prod

# ---- Production ----
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/main"]
