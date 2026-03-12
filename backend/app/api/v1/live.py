from fastapi import APIRouter, WebSocket
from backend.app.services.live_service import handle_live_session

router = APIRouter(tags=["Live Voice — Chef Aika"])


@router.websocket("/ws/live")
async def live_voice_session(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice conversation with Chef Aika.
    
    Connect from the browser and stream microphone PCM audio.
    Gemini Live API processes speech and responds with voice audio.
    
    Protocol:
    - Send: {"type": "audio", "data": "<base64 PCM>"}
    - Send: {"type": "text", "data": "message"} (text fallback)
    - Receive: {"type": "audio", "data": "<base64>", "final": true/false}
    - Receive: {"type": "text", "data": "transcript"}
    """
    await handle_live_session(websocket)
