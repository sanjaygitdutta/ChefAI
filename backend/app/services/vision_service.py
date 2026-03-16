"""
Vision Service — Uses Gemini to analyze a photo of the user's fridge/pantry
and return a structured list of detected ingredients.
"""
import base64
import json
import re
from io import BytesIO

import google.generativeai as genai  # type: ignore
from fastapi import HTTPException, status  # type: ignore
from PIL import Image

from backend.app.core.config import settings  # type: ignore

VISION_MODEL_NAME = "gemini-2.5-flash"

VISION_PROMPT = """
You are an expert chef AI analyzing a photo of a fridge, pantry, or collection of food items.

Carefully identify ALL visible ingredients, food items, and condiments.

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "ingredients": [
    {"name": "eggs", "quantity": "6", "unit": "pieces", "category": "Protein"},
    {"name": "milk", "quantity": "1", "unit": "liter", "category": "Dairy"}
  ],
  "confidence": "high",
  "notes": "Optional note about image quality or uncertainty."
}

Categories to use: Protein, Dairy, Vegetable, Fruit, Grain, Spice, Condiment, Beverage, Other
If quantity is unclear, omit it. Keep ingredient names simple and lowercase.
"""


async def analyze_fridge_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Takes raw image bytes, sends to Gemini Vision, returns detected ingredients.
    """
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your-gemini-api-key-here":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured."
        )

    try:
        # Configure API key and create model fresh each call
        genai.configure(api_key=settings.GEMINI_API_KEY)
        vision_model = genai.GenerativeModel(VISION_MODEL_NAME)

        # Encode the image as base64 for Gemini
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        response = vision_model.generate_content([
            {"mime_type": mime_type, "data": image_b64},
            VISION_PROMPT
        ])

        raw = response.text.strip()
        raw = re.sub(r"^```json\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        data = json.loads(raw)
        return data

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Vision AI returned an unreadable response. Try a clearer image."
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Vision service error: {str(e)}"
        )
