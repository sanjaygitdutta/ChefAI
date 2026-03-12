from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class FridgeItemCreate(BaseModel):
    """Schema for adding an ingredient to the user's fridge."""
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class FridgeItemRead(FridgeItemCreate):
    """Schema for returning a fridge item from the API."""
    id: int
    added_at: datetime

    class Config:
        from_attributes = True
