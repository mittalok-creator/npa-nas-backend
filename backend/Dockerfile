FROM node:22-bookworm-slim

# better-sqlite3 needs to compile a native addon on install -- python3/make/g++
# are the standard build toolchain node-gyp expects; removed after install so
# the final image doesn't carry a whole compiler toolchain at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 4100
CMD ["node", "src/server.js"]
