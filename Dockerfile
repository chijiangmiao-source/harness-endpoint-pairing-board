# syntax=docker/dockerfile:1

# ---- 构建阶段：类型检查 + 生产构建 ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# 此阶段只做类型检查与打包，不需要 Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行 / 验收阶段 ----
# 直接使用与 @playwright/test 版本精确匹配的官方镜像：
# Chromium（含 headless shell）及其全部系统库都已预装，
# 避免手工维护 apt 依赖清单导致 verify 容器内浏览器启动失败。
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime

# 官方镜像默认以非特权用户 pwuser 运行；构建步骤先切回 root，
# 收尾时把 /app 交还给 pwuser（验收需要在其中写 test-results/ 与报告目录）。
USER root
WORKDIR /app

COPY package.json package-lock.json ./
# 官方镜像已在 /ms-playwright 预装与 1.63.0 匹配的 Chromium，npm 安装时无需重复下载
# （该变量只在安装阶段生效，不影响运行时查找浏览器）
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --include=dev

COPY . .
COPY --from=build /app/dist ./dist
RUN chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 4173

# 默认作为页面服务（vite preview，监听 0.0.0.0:4173）；
# compose 中的 verify 服务会用 `npx playwright test` 覆盖此命令。
CMD ["npm", "run", "preview"]
