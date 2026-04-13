# Stage 1: Compile TypeScript
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY views/ ./views/
COPY public/ ./public/

EXPOSE 3000
VOLUME ["/data"]
ENV DB_PATH=/data/library.db
CMD ["node", "dist/index.js"]
