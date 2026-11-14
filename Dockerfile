# Imagen única: compila el front y lo sirve desde el back.
FROM node:24-alpine AS front
WORKDIR /app/front
COPY front/package*.json ./
RUN npm ci
COPY front/ ./
# Cálculos que comparten el front y el back.
COPY shared/ /app/shared/
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app/back
COPY back/package*.json ./
RUN npm ci --omit=dev
COPY back/src ./src
COPY shared/ /app/shared/
COPY --from=front /app/front/dist /app/front/dist
# Sin Turso configurado, la base de datos local vive aquí (monta un volumen para conservarla).
RUN mkdir -p /app/back/data && chown node:node /app/back/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "src/index.js"]
