FROM node:20-slim

WORKDIR /app

# Install dependencies required by Baileys/Puppeteer (if any, although Baileys uses WA Socket directly, so node:20-slim is usually fine)

COPY package*.json ./

RUN npm ci

COPY . .

# Expose port
EXPOSE 3001

CMD ["npm", "start"]
