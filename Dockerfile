FROM node:22-bookworm-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
RUN bash -lc 'for i in 1 2 3 4 5; do corepack prepare pnpm@9.12.3 --activate && exit 0; echo "corepack retry $i"; sleep $((i*5)); done; exit 1'

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN bash -lc 'for i in 1 2 3 4 5; do pnpm install --frozen-lockfile && exit 0; echo "pnpm install retry $i"; sleep $((i*5)); done; exit 1'
RUN pnpm --filter @dispatchos/config build \
  && pnpm --filter @dispatchos/shared build \
  && pnpm --filter @dispatchos/api build

EXPOSE 8080

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
