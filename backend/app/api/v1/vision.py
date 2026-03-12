from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from backend.app.services.vision_service import analyze_fridge_image

router = APIRouter(prefix="/vision", tags=["Vision — Fridge Scanner"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


@router.post("/scan", summary="Scan fridge photo to detect ingredients")
async def scan_fridge(image: UploadFile = File(...)):
    """
    Upload a photo of your fridge, pantry, or ingredients.
    Gemini Vision will analyze it and return a list of detected ingredients.
    
    Returns a JSON object with:
    - `ingredients`: list of detected items (name, quantity, unit, category)
    - `confidence`: how confident the AI is in its detection
    - `notes`: any observations about the image
    """
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{image.content_type}'. Use JPEG, PNG, or WebP."
        )

    image_bytes = await image.read()

    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=413, detail="Image too large. Please use an image under 10MB.")

    result = await analyze_fridge_image(image_bytes, image.content_type)
    return JSONResponse(content=result)
