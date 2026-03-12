import json
import re
import google.generativeai as genai
from fastapi import HTTPException, status

from backend.app.core.config import settings
from backend.app.schemas.recipe import RecipeGenerateRequest, AIRecipeResponse

# Configure the Gemini client with our API key
genai.configure(api_key=settings.GEMINI_API_KEY)

# Use Gemini Flash — it's fast and very capable for this kind of structured generation
model = genai.GenerativeModel("gemini-1.5-flash")


def _build_prompt(request: RecipeGenerateRequest) -> str:
    """
    Build a structured prompt for Gemini.
    We ask for JSON to make the response easy to parse.
    """
    ingredients_str = ", ".join(request.ingredients)
    restrictions = ""
    if request.dietary_restrictions:
        restrictions = f"\nDietary restrictions: {', '.join(request.dietary_restrictions)}"

    return f"""
You are a professional chef AI. Based on the ingredients provided, create ONE delicious recipe.

Ingredients available: {ingredients_str}{restrictions}
Servings: {request.servings}

Respond ONLY with a valid JSON object (no markdown, no explanation), following this exact structure:
{{
  "name": "Recipe Name",
  "description": "A short, appetizing description of the dish (1-2 sentences).",
  "ingredients_used": ["ingredient 1 with quantity", "ingredient 2 with quantity"],
  "instructions": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "prep_time": 10,
  "cook_time": 20,
  "servings": {request.servings},
  "tips": "Optional chef's tip for best results."
}}
"""


async def generate_recipe_from_ingredients(request: RecipeGenerateRequest) -> AIRecipeResponse:
    """
    Calls the Gemini API and returns a structured recipe.
    Raises an HTTPException if the API call fails or the response can't be parsed.
    """
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your-gemini-api-key-here":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file."
        )

    prompt = _build_prompt(request)

    try:
        response = model.generate_content(prompt)
        raw_text = response.text.strip()

        # Sometimes Gemini wraps the JSON in markdown code fences — strip them if present
        raw_text = re.sub(r"^```json\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        data = json.loads(raw_text)
        return AIRecipeResponse(**data)

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The AI returned an unreadable response. Please try again."
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI service error: {str(e)}"
        )
