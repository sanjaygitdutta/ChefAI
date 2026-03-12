from typing import List
from fastapi import APIRouter, HTTPException, status
from google.cloud import firestore

from backend.app.db.firestore import get_firestore_client
from backend.app.schemas.fridge import FridgeItemCreate, FridgeItemRead
from datetime import datetime, timezone

router = APIRouter(prefix="/ingredients", tags=["Fridge Ingredients"])


def _get_db():
    db = get_firestore_client()
    if not db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firestore Database is not configured or disabled."
        )
    return db


@router.get("/", response_model=List[dict])
def list_fridge():
    """List all ingredients currently in the user's fridge."""
    db = _get_db()
    items = []
    docs = db.collection("fridge_items").order_by("name").stream()
    for doc in docs:
        item = doc.to_dict()
        item["id"] = doc.id
        items.append(item)
    return items


@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
def add_to_fridge(item: FridgeItemCreate):
    """Add an ingredient to the fridge."""
    db = _get_db()
    
    # Check for duplicates
    existing = db.collection("fridge_items").where("name", "==", item.name).limit(1).stream()
    if list(existing):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{item.name}' is already in your fridge."
        )

    data = item.model_dump()
    data["added_at"] = datetime.now(timezone.utc)
    
    # Let Firestore generate a random document ID
    _, doc_ref = db.collection("fridge_items").add(data)
    
    data["id"] = doc_ref.id
    return data


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_fridge(item_id: str):
    """Remove an ingredient from the fridge by its ID."""
    db = _get_db()
    doc_ref = db.collection("fridge_items").document(item_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ingredient not found."
        )
    
    doc_ref.delete()
    return None

