# Use the official Python lightweight image
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Install system dependencies (required for some Python packages like Pillow or SQLite if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file into the container
# We copy this first to leverage Docker cache for pip install
COPY backend/requirements.txt ./backend/

# Install Python dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the backend code
COPY backend/ ./backend/

# Copy the frontend code
# The FastAPI app serves this from the /frontend directory
COPY frontend/ ./frontend/

# Expose the port Cloud Run expects (8080)
EXPOSE 8080

# Command to run the application using Uvicorn
# We bind to 0.0.0.0 to allow external access, and use the PORT environment variable
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8080"]
