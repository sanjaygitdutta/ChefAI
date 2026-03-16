"""
Gemini Live API service — handles real-time voice/audio WebSocket proxying.

High-Responsiveness Strategy:
  - Real-time streaming: Audio chunks sent to Gemini IMMEDIATELY as they arrive.
  - Latency: Gemini processes voice incrementally while the user is still speaking.
  - Snap Turn Detection: Sends turn_complete=True after 0.8s of silence.
"""
import asyncio
import base64
import time

from google import genai  # type: ignore
from google.genai import types  # type: ignore
from fastapi import WebSocket, WebSocketDisconnect  # type: ignore

from backend.app.core.config import settings
from backend.app.core.prompts import CHEF_SYSTEM_PROMPT

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

# Tool definitions for Gemini to control the UI
TOOLS = [
    {
        "function_declarations": [
            {
                "name": "trigger_camera_scan",
                "description": "Opens the user's camera to scan ingredients or identify items in the kitchen.",
            },
            {
                "name": "generate_recipe_ui",
                "description": "Triggers the automatic generation of a recipe based on currently loaded ingredients. Use this when the user says they are ready to cook or wants a suggestion.",
            },
            {
                "name": "set_kitchen_timer",
                "description": "Sets a countdown timer with a specific label.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "seconds": {"type": "INTEGER", "description": "Duration in seconds."},
                        "label": {"type": "STRING", "description": "What the timer is for (e.g. 'Pasta', 'Egg')."}
                    },
                    "required": ["seconds", "label"]
                }
            },
            {
                "name": "highlight_recipe_step",
                "description": "Visually highlights a specific step in the recipe instructions during a cook-along.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "step_text": {"type": "STRING", "description": "The text of the step to highlight."}
                    },
                    "required": ["step_text"]
                }
            }
        ]
    }
]

# Snappy turn detection: wait 0.8s after last audio chunk to trigger response
SILENCE_TIMEOUT = 0.8   # seconds
# Minimum silence before we consider a turn finished (prevents cutting off mid-word)
TURN_DETECTION_CHECK_INTERVAL = 0.1 # seconds


async def handle_live_session(websocket: WebSocket):
    await websocket.accept()

    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your-gemini-api-key-here":
        await websocket.send_json({
            "type": "error",
            "message": "Gemini API key is not configured on the server."
        })
        await websocket.close()
        return

    await websocket.send_json({"type": "connected", "message": "Chef Aika is ready!"})

    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        live_config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(
                parts=[types.Part(text=CHEF_SYSTEM_PROMPT)]
            ),
            tools=TOOLS,
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Aoede"
                    )
                )
            )
        )

        async with client.aio.live.connect(
            model=LIVE_MODEL,
            config=live_config
        ) as session:

            # Monitoring state
            last_audio_time = [time.time()]
            is_turn_pending = [False]

            async def silence_watcher():
                """Explicitly signals turn_complete after 0.8s of silence."""
                while True:
                    await asyncio.sleep(TURN_DETECTION_CHECK_INTERVAL)
                    if is_turn_pending[0]:
                        elapsed = time.time() - last_audio_time[0]
                        if elapsed >= SILENCE_TIMEOUT:
                            print(f"[Aika] Turn complete detected (silence: {elapsed:.1f}s). Signaling Gemini...")
                            is_turn_pending[0] = False
                            # Empty content with turn_complete triggers immediate response
                            await session.send_client_content(
                                turns=[],
                                turn_complete=True
                            )

            async def receive_from_client():
                """Listen to messages from the browser and pump to Gemini."""
                async for message in websocket.iter_json():
                    msg_type = message.get("type")

                    if msg_type == "audio":
                        # CRITICAL: Stream to Gemini IMMEDIATELY for low latency
                        # Gemini starts processing while user is still talking.
                        try:
                            await session.send_realtime_input(
                                input=[types.Blob(
                                    mime_type="audio/pcm;rate=16000",
                                    data=base64.b64decode(message["data"])
                                )]
                            )
                            last_audio_time[0] = time.time()
                            is_turn_pending[0] = True
                        except Exception as ex:
                            print(f"[Aika] Error streaming audio to Gemini: {ex}")

                    elif msg_type == "text":
                        # Support sending text directly through the websocket to prompt Aika's voice
                        text_data = message.get("data", "")
                        if text_data:
                            print(f"[Aika] Sending text to Model: {text_data}")
                            try:
                                await session.send_client_content(
                                    turns=[types.Content(parts=[types.Part(text=text_data)])],
                                    turn_complete=True
                                )
                            except Exception as ex:
                                print(f"[Aika] Error sending text to Gemini: {ex}")

                    elif msg_type == "image":
                        # Image messages are immediate turns
                        is_turn_pending[0] = False
                        print(f"[Aika] Processing image turn: {message['data']}")
                        await session.send_client_content(
                            turns=[types.Content(
                                parts=[types.Part(text=message["data"])]
                            )],
                            turn_complete=True
                        )

                    elif msg_type == "end_session":
                        break

            async def receive_from_gemini():
                """Stream Gemini's audio + text chunks back to the browser."""
                async for response in session.receive():
                    # Handle Tool Calls FIRST — tool_call is on LiveServerMessage (response),
                    # not on server_content. Tool call responses arrive with server_content=None,
                    # so we must check BEFORE the server_content guard below.
                    tool_call = getattr(response, "tool_call", None)
                    if tool_call and getattr(tool_call, "function_calls", None):
                        for fc in tool_call.function_calls:
                            fc_name = getattr(fc, "name", "")
                            fc_args = getattr(fc, "args", {})
                            fc_id   = getattr(fc, "id", "")
                            print(f"[Aika] Model requested tool: {fc_name}({fc_args})")
                            # Forward tool call to frontend via WebSocket
                            await websocket.send_json({
                                "type": "tool_call",
                                "name": fc_name,
                                "args": dict(fc_args) if fc_args else {},
                                "id":   fc_id
                            })

                            # CRITICAL: Respond immediately so Gemini doesn't get stuck waiting.
                            try:
                                # The official way to send responses in the google.genai Live API
                                # We must use LiveClientContent with the tool_response key mapped to parts
                                await session.send(
                                    input=types.LiveClientContent(
                                        tool_response=types.ToolResponse(
                                            function_responses=[
                                                types.FunctionResponse(
                                                    name=fc_name,
                                                    id=fc_id,
                                                    response={"result": "success"}
                                                )
                                            ]
                                        )
                                    )
                                )
                            except Exception as e:
                                print(f"[Aika] Error sending tool response {fc_name}: {e}")
                        continue  # tool_call responses have no server_content — skip below

                    server_content = response.server_content
                    if not server_content:
                        continue

                    model_turn = server_content.model_turn
                    if model_turn and getattr(model_turn, "parts", None):
                        for part in model_turn.parts:
                            # Audio playback
                            inline_data = getattr(part, "inline_data", None)
                            if inline_data and getattr(inline_data, "data", None):
                                await websocket.send_json({
                                    "type": "audio",
                                    "data": base64.b64encode(inline_data.data).decode("utf-8"),
                                    "final": False
                                })

                            # Text transcript (useful for UI debugging)
                            part_text = getattr(part, "text", None)
                            if part_text:
                                print(f"[Aika] AI: {part_text}")
                                await websocket.send_json({
                                    "type": "text",
                                    "data": part_text
                                })

                    if getattr(server_content, "turn_complete", False):
                        await websocket.send_json({
                            "type": "audio", "data": "", "final": True
                        })

            await asyncio.gather(
                receive_from_client(),
                receive_from_gemini(),
                silence_watcher()
            )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Aika] Fatal session error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": f"Session error: {str(e)}"})
        except Exception:
            pass
