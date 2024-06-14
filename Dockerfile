# Use the official Node.js 22.3.0 image as the base image
FROM node:16

# Set the working directory in the Docker image to /app
WORKDIR /app

# Copy package.json and package-lock.json (if available) into the Docker image
COPY package*.json ./

# Install the app's dependencies in the Docker image
RUN npm install

# Copy the rest of the app into the Docker image
COPY . .

# Specify the command to run the app
CMD [ "npm", "start" ]
