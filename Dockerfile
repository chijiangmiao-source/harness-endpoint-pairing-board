# syntax=docker/dockerfile:1

# ---- 构建阶段：类型检查 + 生产构建 ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行 / 验收阶段：内置 Chromium 与系统库，页面服务与验收共用同一镜像 ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Chromium 运行所需的系统库（对照 Playwright 官方 Debian 12 依赖清单）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
        libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
        libnspr4 libnss3 libpango-1.0-0 \
        libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
        libxfixes3 libxkbcommon0 libxrandr2 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
    && npx playwright install chromium \
    && npm cache clean --force
COPY . .
COPY --from=build /app/dist ./dist

EXPOSE 4173

# 默认作为页面服务（4173）；verify 服务会覆盖此命令
CMD ["npm", "run", "preview"]
