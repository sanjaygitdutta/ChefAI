from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class RecipeRead(BaseModel):
    """Schema for returning a saved recipe from the database."""
    id: int
    name: str
    description: Optional[str] = None
    instructions: str
    ingredients_used: Optional[str] = None
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    servings: int
    created_at: datetime

    class Config:
        from_attributes = True


class RecipeGenerateRequest(BaseModel):
    """Request body for the AI recipe generation endpoint."""
    ingredients: List[str]           # e.g. ["eggs", "flour", "milk", "butter"]
    dietary_restrictions: Optional[List[str]] = []  # e.g. ["vegetarian", "gluten-free"]
    servings: Optional[int] = 2


class AIRecipeResponse(BaseModel):
    """Schema for the structured recipe returned by the Gemini AI service."""
    name: str
    description: str
    ingredients_used: List[str]
    instructions: List[str]          # Each step as a separate list item
    prep_time: Optional[int] = None  # In minutes
    cook_time: Optional[int] = None  # In minutes
    servings: int
    tips: Optional[str] = None       # Optional chef's tips from the AI
