FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
RUN bash -lc 'for i in 1 2 3 4 5; do corepack prepare pnpm@9.12.3 --activate && exit 0; echo "corepack retry $i"; sleep $((i*5)); done; exit 1'

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

ARG VITE_API_BASE_URL
ARG VITE_DEV_AUTH_TOKEN
ARG VITE_ALLOW_FALLBACK_LOGIN
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEV_AUTH_TOKEN=$VITE_DEV_AUTH_TOKEN
ENV VITE_ALLOW_FALLBACK_LOGIN=$VITE_ALLOW_FALLBACK_LOGIN
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN bash -lc 'for i in 1 2 3 4 5; do pnpm install --frozen-lockfile && exit 0; echo "pnpm install retry $i"; sleep $((i*5)); done; exit 1'
RUN pnpm --filter @dispatchos/web build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
