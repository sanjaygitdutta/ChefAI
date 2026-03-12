import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.core.config import settings
from backend.app.api.v1 import ingredients, recipes, vision, live

# Create the FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    description="🍳 Chef Aika — Your AI kitchen companion. See your fridge, speak your cravings, hear your recipe.",
)

# ── CORS Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup Event ─────────────────────────────────────────────────────────────
@app.on_event("startup")
def on_startup():
    # Application startup logic (e.g. warming up caches if needed)
    pass

# ── API Routers ───────────────────────────────────────────────────────────────
app.include_router(ingredients.router, prefix="/api/v1")
app.include_router(recipes.router, prefix="/api/v1")
app.include_router(vision.router, prefix="/api/v1")
app.include_router(live.router)  # WebSocket at /ws/live (no prefix)

# ── Serve Frontend ────────────────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def serve_frontend():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}
