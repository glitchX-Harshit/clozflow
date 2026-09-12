# Build stage
FROM node:20-slim as build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# Build the Vite application
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
