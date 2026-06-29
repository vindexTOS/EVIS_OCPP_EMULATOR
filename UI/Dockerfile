# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app

# ---- Dependencies ----
# Cached separately so installs only re-run when manifests change.
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- Development ----
# Used by docker-compose. Source is bind-mounted, so Vite hot-reloads
# on changes. --host exposes the dev server outside the container.
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
# Serves the static build with Vite's preview server.
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json vite.config.ts ./
EXPOSE 5173
CMD ["yarn", "preview", "--host", "0.0.0.0", "--port", "5173"]
