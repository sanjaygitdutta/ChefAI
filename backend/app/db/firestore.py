import os
from google.cloud import firestore
from backend.app.core.config import settings

# Initialize Firestore DB
# In local development, if you don't have a service account JSON,
# this will use the default project configured via `gcloud auth application-default login`
# When deployed on Cloud Run, it automatically uses the container's service account.

try:
    db = firestore.Client()
except Exception as e:
    print(f"Failed to initialize Firestore Client: {e}")
    print("If testing locally, make sure you ran: gcloud auth application-default login")
    db = None

def get_firestore_client():
    """Returns the Firestore client instance."""
    return db
