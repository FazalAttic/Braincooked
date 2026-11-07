# -----------------------------------------------------------------------------
# High-Performance ElysiaJS Backend on Bun Runtime
# -----------------------------------------------------------------------------

FROM oven/bun:1.4-alpine AS base
WORKDIR /app

# Install dependencies into temp directory to cache them
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock* /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile || bun install

# Copy node_modules across and build
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Run the server
FROM base AS release
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

USER bun
EXPOSE 4000
ENV PORT=4000

ENTRYPOINT [ "bun", "run", "src/index.ts" ]

