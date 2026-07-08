# Use the official Node.js image as the base image
FROM node:22.3.0

WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 4000

CMD [ "npm", "run", "start:prod" ]
