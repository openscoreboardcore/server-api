# Build stage
FROM oven/bun:1.3

# Install fonts
RUN apt-get update && apt-get install -y \
    fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory inside container
WORKDIR /app

# Copy package.json and bun.lockb to install dependencies first (cache)
COPY package.json bun.lockb* /app/

# Install dependencies
RUN bun install

# Copy all project files
COPY . .

# Expose port 3000 (change if your Bun app uses a different port)
EXPOSE 3000

# Default command to run your Bun app
CMD ["bun", "run", "start"]