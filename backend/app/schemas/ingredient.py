from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class IngredientCreate(BaseModel):
    """Schema for adding a new ingredient to the master list."""
    name: str
    category: Optional[str] = None
    unit: Optional[str] = None


class IngredientRead(IngredientCreate):
    """Schema for returning an ingredient from the API (includes DB-generated fields)."""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True  # Allows reading from SQLAlchemy model instances
