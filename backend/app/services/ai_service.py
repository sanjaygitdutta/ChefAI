import json
import re
import time
import google.generativeai as genai  # type: ignore
from fastapi import HTTPException, status  # type: ignore

from backend.app.core.config import settings  # type: ignore
from backend.app.schemas.recipe import RecipeGenerateRequest, AIRecipeResponse  # type: ignore

# Primary and fallback models
PRIMARY_MODEL = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.5-flash-lite"


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


def _call_model_with_retry(prompt: str, model_name: str, max_retries: int = 2) -> str:
    """Calls a Gemini model with exponential backoff retry on quota errors."""
    # Configure fresh every call to always use the latest API key from .env
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(model_name)
    last_error: Exception = RuntimeError("No attempts made")
    for attempt in range(max_retries + 1):
        try:
            response = model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            last_error = e
            err_str = str(e)
            if "429" in err_str and attempt < max_retries:
                wait_time = 2 ** attempt  # 1s, 2s, 4s...
                print(f"Rate limit hit on {model_name}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise
    raise last_error


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
        # Try primary model first, then fallback if quota exceeded
        try:
            raw_text = _call_model_with_retry(prompt, PRIMARY_MODEL)
        except Exception as e:
            if "429" in str(e):
                print(f"Primary model quota exhausted, falling back to {FALLBACK_MODEL}...")
                raw_text = _call_model_with_retry(prompt, FALLBACK_MODEL)
            else:
                raise

        # Strip markdown code fences if present
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
