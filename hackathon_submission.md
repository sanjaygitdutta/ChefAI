# Fridge Chef AI — Hackathon Submission Guide

Congratulations on pivoting to the **Gemini Live Agent Challenge**! Here is the text and documentation you need for your Devpost submission.

---

## 📃 Text Description

**Project Summary**  
Fridge Chef AI is a next-generation kitchen assistant that moves beyond the text box. It acts as an immersive, real-time "Live Agent" that helps users *see, hear, and speak* while they cook. 

Instead of typing out ingredients, users simply point their camera at their fridge. Gemini Vision scans the shelves and automatically builds a digital pantry. From there, users can simply click a button to talk directly to "Chef Aika" via the Gemini Live API. Because it's a Live API agent, Chef Aika is fully conversational, interruptible, and context-aware. She can parse the scanned ingredients, generate a structured recipe using Gemini 1.5 Flash, and guide the user through the cooking process step-by-step using continuous audio output.

**Technologies Used**  
- **Voice/Live AI:** Gemini 2.0 Flash Live API (WebSocket audio streaming) for real-time conversation and graceful interruptions.
- **Vision AI:** Gemini 1.5 Flash Vision for zero-shot object detection (fridge scanning).
- **Generative AI:** Gemini 1.5 Flash for structured JSON recipe generation.
- **Backend Infrastructure:** Python FastAPI hosted on Google Cloud Run.
- **Database:** Google Cloud Firestore (NoSQL) for persisting the generated recipes and pantry state.
- **Frontend Interactivity:** Vanilla JS leveraging WebRTC for camera access and Web Audio API + PCM decoding for zero-latency audio streaming with the Live API.

**Findings & Learnings**  
Working with the Gemini Live API over WebSockets taught us the intricacies of streaming raw PCM audio. Handling the real-time bidirectional stream required careful synchronization between the browser's AudioContext and the FastAPI server. One key learning was discovering how Gemini handles interruptions; we designed the frontend waveform visualizer to react specifically to the `turn_complete` signals to give users visual feedback that the AI is listening versus speaking.

---

## 👨‍💻 Spin-Up Instructions (Add this to your README.md)

### Running Locally
1. Clone the repository
2. Install dependencies: `pip install -r backend/requirements.txt`
3. Add your Gemini API Key to `backend/.env` (`GEMINI_API_KEY="your-key"`)
4. Authenticate with Google Cloud for Firestore access: `gcloud auth application-default login`
5. Run the server: `uvicorn backend.app.main:app --reload`
6. Open your browser to `http://localhost:8000`

### Deploying to Google Cloud
We provided Infrastructure as Code (IaC) via a bash deployment script:
```bash
./deploy.sh <YOUR_GCP_PROJECT_ID> <YOUR_GEMINI_API_KEY>
```
*Note: This script automatically enables Cloud Run, Cloud Build, and Firestore APIs, builds the Dockerfile, and deploys the service.*

---

## 🏗️ Architecture Diagram
*(You should generate a visual flow chart from this logic to attach in the Devpost image carousel)*

1. **Input Layer (Browser):** WebRTC Camera & Microphone.
2. **WebSocket Proxy (Cloud Run):** FastAPI receives incoming Blob images and PCM audio streams.
3. **AI Layer (Google Gen AI SDK):** 
    - Images go to `gemini-1.5-flash` for detection.
    - Audio streams go to `gemini-2.0-flash-live-001` for real-time conversation.
4. **Data Layer (Firestore):** Generated recipes are saved to Cloud Firestore `fridge_items` and `recipes` collections.
5. **Output Layer (Browser):** Raw PCM audio from Gemini is wrapped in WAV headers in JS and played via Web Audio API, accompanied by dynamic DOM updates.

---

