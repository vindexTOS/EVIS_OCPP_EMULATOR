# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app

# ---- Dependencies ----
# Cached separately so installs only re-run when manifests change.
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- Development ----
# Used by docker-compose.dev.yml only. Source is bind-mounted, so Vite
# hot-reloads on changes. --host listens on every interface *inside* the
# container; docker-compose.dev.yml publishes it on 127.0.0.1 only. Never
# publish this stage to a network: the dev server compiles whatever a request
# names (GHSA-p4f5-76q4-ffq7 made that remote code execution).
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["yarn", "dev", "--host", "0.0.0.0"]

# ---- Build ----
FROM deps AS build
COPY . .
RUN yarn build

# ---- Production ----
# Used by docker-compose.yml. Serves the static build with Vite's preview
# server, which only serves files and forwards /api and /socket.io: it compiles
# nothing on request.
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json vite.config.ts ./
EXPOSE 5173
CMD ["yarn", "preview", "--host", "0.0.0.0", "--port", "5173"]
