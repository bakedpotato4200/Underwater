# Use the official Node 18 image
FROM node:18

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your project
COPY . .

# Expose the port Railway assigns
EXPOSE 3000

# Start your server
CMD ["node", "src/api.js"]
