FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY gateway ./gateway
COPY yurots ./yurots
COPY src ./src
COPY css ./css
COPY png ./png
COPY sounds ./sounds
COPY data ./data
COPY index.html yurots.html ./
ENV BIND=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "gateway/server.mjs"]
