"""
Gemini Live API service — handles real-time voice/audio WebSocket proxying.
This bridges the browser's microphone stream to Gemini Live API.
"""
import asyncio
import base64
import json

import google.generativeai as genai
from fastapi import WebSocket, WebSocketDisconnect

from backend.app.core.config import settings
from backend.app.core.prompts import CHEF_SYSTEM_PROMPT
from backend.app.db.firestore import get_firestore_client

genai.configure(api_key=settings.GEMINI_API_KEY)


async def handle_live_session(websocket: WebSocket):
    """
    Manages a full Gemini Live API voice session for one user.
    
    Protocol (JSON over WebSocket):
    
    Client → Server:
      {"type": "audio", "data": "<base64 PCM audio>"}
      {"type": "text", "data": "a text message from user"}
      {"type": "end_session"}
    
    Server → Client:
      {"type": "audio", "data": "<base64 PCM audio>", "final": true/false}
      {"type": "text", "data": "transcript text"}
      {"type": "error", "message": "..."}
      {"type": "connected"}
    """
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
        # Use Gemini 2.0 Flash for Live API (multimodal, low latency)
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        
        tools = [{"function_declarations": [
            {
                "name": "generate_recipe_ui",
                "description": "Trigger the frontend UI to generate a recipe based on the user's currently scanned ingredients. Use this whenever the user asks for a recipe or meal idea based on their ingredients.",
            },
            {
                "name": "trigger_camera_scan",
                "description": "Trigger the frontend UI to open the camera and scan the fridge for ingredients. Use this when the user asks you to look at their fridge or scan ingredients.",
            },
            {
                "name": "save_verbal_recipe",
                "description": "Save a newly invented recipe that you and the user discussed to their digital cookbook.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {"type": "STRING", "description": "Name of the recipe"},
                        "description": {"type": "STRING", "description": "Short appetizing description"},
                        "ingredients_used": {
                            "type": "ARRAY", 
                            "items": {"type": "STRING"},
                            "description": "List of strings, e.g. ['2 eggs', '1 cup flour']"
                        },
                        "instructions": {
                            "type": "ARRAY",
                            "items": {"type": "STRING"},
                            "description": "List of instructional steps"
                        }
                    },
                    "required": ["name", "description", "ingredients_used", "instructions"]
                }
            },
            {
                "name": "set_kitchen_timer",
                "description": "Start a visual countdown timer on the user's screen. Use this when the user asks you to set a timer for cooking.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "seconds": {"type": "INTEGER", "description": "Total duration of the timer in seconds"},
                        "label": {"type": "STRING", "description": "Short label for the timer, e.g. 'Boiling Pasta'"}
                    },
                    "required": ["seconds", "label"]
                }
            },
            {
                "name": "switch_to_ramsay_mode",
                "description": "Drop your friendly persona and immediately become Gordon Ramsay: a harsh, demanding, and sarcastic Michelin-star chef. Use this when the user asks you to be mean or act like Gordon Ramsay."
            },
            {
                "name": "highlight_recipe_step",
                "description": "Highlight a specific recipe step on the user's screen while you are reading it aloud.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "step_text": {"type": "STRING", "description": "The exact text of the step you are reading"}
                    },
                    "required": ["step_text"]
                }
            }
        ]}]

        live_config = {
            "response_modalities": ["AUDIO"],
            "system_instruction": {"parts": [{"text": CHEF_SYSTEM_PROMPT}]},
            "tools": tools,
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": "Aoede"}  # Warm, natural voice
                }
            }
        }

        async with client.aio.live.connect(
            model="gemini-2.0-flash-live-001",
            config=live_config
        ) as session:

            async def receive_from_client():
                """Listen to messages from the browser."""
                async for message in websocket.iter_json():
                    msg_type = message.get("type")

                    if msg_type == "audio":
                        # Raw PCM audio from microphone (base64 encoded)
                        audio_data = base64.b64decode(message["data"])
                        await session.send({"mime_type": "audio/pcm", "data": audio_data})

                    elif msg_type == "text":
                        # Text fallback (if microphone not available)
                        await session.send(message["data"], end_of_turn=True)
                        
                    elif msg_type == "image":
                        # Raw JPEG frame from camera (Ultimate Tweak)
                        image_data = base64.b64decode(message["data"])
                        await session.send({"mime_type": "image/jpeg", "data": image_data})
                        
                    elif msg_type == "tool_response":
                        # Send mock result of the tool back to Gemini
                        tool_res = {
                            "function_responses": [{
                                "id": message.get("call_id", ""),
                                "name": message.get("tool", ""),
                                "response": {"result": message.get("result", "success")}
                            }]
                        }
                        await session.send(tool_res)
                        
                        # Handle backend-side tool execution
                        tool_name = message.get("tool", "")
                        args = message.get("args", {})
                        
                        if tool_name == "save_verbal_recipe" and message.get("result") == "success":
                            db = get_firestore_client()
                            if db is not None:
                                try:
                                    recipe_data = {
                                        "name": args.get("name", "Untitled Recipe"),
                                        "description": args.get("description", ""),
                                        "ingredients_used": args.get("ingredients_used", []),
                                        "instructions": args.get("instructions", []),
                                        "servings": 2,
                                        "prep_time": 0,
                                        "cook_time": 0,
                                        "dietary_restrictions": [],
                                        "image_url": None
                                    }
                                    db.collection("recipes").add(recipe_data)
                                    print(f"Saved verbal recipe to Firestore: {recipe_data['name']}")
                                except Exception as e:
                                    print(f"Error saving recipe to Firestore: {e}")

                    elif msg_type == "end_session":
                        break

            async def receive_from_gemini():
                """Stream Gemini's audio/text response back to browser."""
                async for response in session.receive():
                    if response.data:
                        # Audio chunk — send to browser as base64
                        await websocket.send_json({
                            "type": "audio",
                            "data": base64.b64encode(response.data).decode("utf-8"),
                            "final": False
                        })
                    if response.text:
                        await websocket.send_json({
                            "type": "text",
                            "data": response.text
                        })
                        
                    # Handle Tool Calls securely by inspecting parts
                    server_content = getattr(response, "server_content", None)
                    if server_content:
                        model_turn = getattr(server_content, "model_turn", None)
                        if model_turn and hasattr(model_turn, "parts"):
                            for part in model_turn.parts:
                                if hasattr(part, "function_call") and part.function_call:
                                    func_name = part.function_call.name
                                    call_id = getattr(part.function_call, "id", "")
                                    args = getattr(part.function_call, "args", {})
                                    
                                    # Convert args to dict safely
                                    args_dict = {}
                                    if isinstance(args, dict):
                                        args_dict = args
                                    else:
                                        try:
                                            args_dict = dict(args)
                                        except:
                                            pass

                                    await websocket.send_json({
                                        "type": "tool_call",
                                        "tool": func_name,
                                        "call_id": call_id,
                                        "args": args_dict
                                    })

                        if getattr(server_content, "turn_complete", False):
                            await websocket.send_json({
                                "type": "audio", "data": "", "final": True
                            })

            # Run both directions concurrently
            await asyncio.gather(
                receive_from_client(),
                receive_from_gemini()
            )

    except WebSocketDisconnect:
        pass  # Browser disconnected — clean exit
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
