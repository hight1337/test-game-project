# Single-image deployment: builds the client, then runs the race server,
# which also serves the built client — one URL for everything.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY shared/ shared/
COPY client/ client/
COPY server/ server/
COPY tsconfig.base.json ./
RUN npm run build -w client

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared && npm cache clean --force
COPY shared/ shared/
COPY server/ server/
COPY --from=build /app/client/dist client/dist
EXPOSE 8090
CMD ["npm", "run", "start", "-w", "server"]
