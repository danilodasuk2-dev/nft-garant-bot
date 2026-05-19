FROM node:24-slim
WORKDIR /app
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --production
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
