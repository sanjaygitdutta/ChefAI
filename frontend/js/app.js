/* ═══════════════════════════════════════════════════════════
   Fridge Chef AI — Frontend Application Logic
   ═══════════════════════════════════════════════════════════ */

const API_BASE = "/api/v1";
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/live`;

// ── State ──────────────────────────────────────────────────
let ingredients = [];
let voiceSocket = null;
let audioContext = null;
let mediaStream = null;
let audioProcessor = null;
let isListening = false;
let audioQueue = [];
let isPlayingGeminiAudio = false;
let videoInterval = null;

// ── DOM Elements ───────────────────────────────────────────
const elIngredientList = document.getElementById("ingredientList");
const elManualIngredient = document.getElementById("manualIngredient");
const elBtnGenerate = document.getElementById("btnGenerate");
const elRecipeCard = document.getElementById("recipeCard");
const elRecipeEmpty = document.getElementById("recipeEmpty");
const elRecipeContent = document.getElementById("recipeContent");
const elLoadingRecipe = document.getElementById("loadingRecipe");
const elServings = document.getElementById("servings");
const elDietary = document.getElementById("dietary");

const elCameraVideo = document.getElementById("cameraVideo");
const elCameraCanvas = document.getElementById("cameraCanvas");
const elBtnStartCamera = document.getElementById("btnStartCamera");
const elBtnScanFridge = document.getElementById("btnScanFridge");
const elScanStatus = document.getElementById("scanStatus");
const elCameraOverlay = document.getElementById("cameraOverlay");

const elBtnVoice = document.getElementById("btnVoice");
const elWaveform = document.getElementById("waveform");
const elTranscriptBox = document.getElementById("transcriptBox");
const elStatusDot = document.getElementById("statusDot");
const elStatusText = document.getElementById("statusText");
const elToast = document.getElementById("toast");


/* ═══════════════════════════════════════════════════════════
   1. INGREDIENT MANAGEMENT 
   ═══════════════════════════════════════════════════════════ */

function renderIngredients() {
    if (ingredients.length === 0) {
        elIngredientList.innerHTML = `<p class="empty-state">No ingredients yet. Scan your fridge or add manually! 🌿</p>`;
        elBtnGenerate.disabled = true;
        return;
    }

    elBtnGenerate.disabled = false;
    elIngredientList.innerHTML = ingredients.map((ing, index) => `
    <div class="ingredient-tag">
      <div>
        <span>${ing.name}</span>
        ${ing.quantity && ing.unit ? `<span style="color:var(--warm-muted); font-size:0.8rem; margin-left:6px;">(${ing.quantity} ${ing.unit})</span>` : ''}
        ${ing.category ? `<span class="category">${ing.category}</span>` : ''}
      </div>
      <button onclick="removeIngredient(${index})" title="Remove">×</button>
    </div>
  `).join('');
}

function addManualIngredient() {
    const val = elManualIngredient.value.trim();
    if (!val) return;
    ingredients.push({ name: val });
    elManualIngredient.value = "";
    renderIngredients();
}

elManualIngredient.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addManualIngredient();
});

function removeIngredient(index) {
    ingredients.splice(index, 1);
    renderIngredients();
}

function clearIngredients() {
    ingredients = [];
    renderIngredients();
}


/* ═══════════════════════════════════════════════════════════
   2. CAMERA & VISION SCANNER
   ═══════════════════════════════════════════════════════════ */

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        elCameraVideo.srcObject = stream;
        elCameraVideo.style.display = 'block';
        elCameraOverlay.style.display = 'flex';
        elBtnStartCamera.style.display = 'none';
        elBtnScanFridge.style.display = 'block';
    } catch (err) {
        showToast("Camera access denied or not available.");
        console.error(err);
    }
}

function stopCamera() {
    const stream = elCameraVideo.srcObject;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        elCameraVideo.srcObject = null;
    }
    elCameraVideo.style.display = 'none';
    elCameraOverlay.style.display = 'none';
    elBtnStartCamera.style.display = 'block';
    elBtnScanFridge.style.display = 'none';
}

async function scanFridge() {
    if (!elCameraVideo.srcObject) return;

    // Capture frame to canvas
    elCameraCanvas.width = elCameraVideo.videoWidth;
    elCameraCanvas.height = elCameraVideo.videoHeight;
    const ctx = elCameraCanvas.getContext('2d');
    ctx.drawImage(elCameraVideo, 0, 0);

    // Convert to Blob
    elCameraCanvas.toBlob(async (blob) => {
        stopCamera(); // Stop camera while processing
        await processImageBlob(blob);
    }, 'image/jpeg', 0.8);
}

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    await processImageBlob(file);
}

async function processImageBlob(blob) {
    elScanStatus.innerText = "🤖 Gemini Vision is analyzing...";
    const formData = new FormData();
    formData.append("image", blob, "fridge.jpg");

    try {
        const res = await fetch(`${API_BASE}/vision/scan`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        if (data.ingredients && Array.isArray(data.ingredients)) {
            ingredients = [...ingredients, ...data.ingredients];
            renderIngredients();
            elScanStatus.innerText = `✅ Found ${data.ingredients.length} items!`;
            setTimeout(() => { elScanStatus.innerText = ""; }, 3000);

            if (document.querySelector('.aika-status').textContent.includes('online')) {
                sendLiveText(`I just showed you my fridge. I now have ${ingredients.length} ingredients loaded.`);
            }
        } else {
            throw new Error("Invalid response format from Vision API.");
        }
    } catch (err) {
        console.error(err);
        elScanStatus.innerText = "❌ Failed to scan image.";
        showToast("Error scanning fridge. Please try again.");
    }
}


/* ═══════════════════════════════════════════════════════════
   3. RECIPE GENERATION 
   ═══════════════════════════════════════════════════════════ */

async function generateRecipe() {
    if (ingredients.length === 0) return;

    elRecipeEmpty.style.display = 'none';
    elRecipeContent.style.display = 'none';
    elLoadingRecipe.style.display = 'flex';

    const payload = {
        ingredients: ingredients.map(i => i.name),
        dietary_restrictions: elDietary.value ? [elDietary.value] : [],
        servings: parseInt(elServings.value) || 2
    };

    try {
        const res = await fetch(`${API_BASE}/recipes/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(await res.text());

        const recipe = await res.json();
        displayRecipe(recipe);

        // If live voice is connected, tell Aika we generated a recipe
        if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
            sendLiveText(`I just generated a recipe called ${recipe.name}. It takes ${recipe.cook_time} minutes to cook. Are there any chef's tips you can give me before I start?`);
        }

    } catch (err) {
        console.error(err);
        showToast("Error generating recipe.");
        elLoadingRecipe.style.display = 'none';
        elRecipeEmpty.style.display = 'block';
    }
}

function displayRecipe(recipe) {
    elLoadingRecipe.style.display = 'none';
    elRecipeContent.style.display = 'block';

    document.getElementById("recipeName").innerText = recipe.name;
    document.getElementById("recipeDescription").innerText = recipe.description;
    document.getElementById("recipePrepTime").innerText = recipe.prep_time ? `${recipe.prep_time}m` : '--';
    document.getElementById("recipeCookTime").innerText = recipe.cook_time ? `${recipe.cook_time}m` : '--';
    document.getElementById("recipeServings").innerText = recipe.servings;

    const ingHtml = recipe.ingredients_used.map(ing => `<li>${ing}</li>`).join('');
    document.getElementById("recipeIngredients").innerHTML = ingHtml;

    const stepHtml = recipe.instructions.map(step => `<li>${step.replace(/^Step \d+:?\s*/i, '')}</li>`).join('');
    document.getElementById("recipeSteps").innerHTML = stepHtml;

    const tipsBox = document.getElementById("recipeTipsBox");
    if (recipe.tips) {
        document.getElementById("recipeTips").innerText = recipe.tips;
        tipsBox.style.display = 'block';
    } else {
        tipsBox.style.display = 'none';
    }
}

function readRecipeAloud() {
    const steps = document.querySelectorAll("#recipeSteps li");
    let textToRead = "Here are the steps. " + Array.from(steps).map((s, i) => `Step ${i + 1}: ${s.innerText}`).join(' ');

    if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
        sendLiveText(`Please read me the following recipe steps aloud: ${textToRead}`);
    } else {
        // Fallback to browser TTS if Live API not connected
        const utterance = new SpeechSynthesisUtterance(textToRead);
        window.speechSynthesis.speak(utterance);
        showToast("Reading aloud via Browser Speech (Connect Chef Aika for live voice!)");
    }
}

/* ═══════════════════════════════════════════════════════════
   X. KITCHEN TIMER 
   ═══════════════════════════════════════════════════════════ */

let kitchenTimerInterval = null;

function startTimer(seconds, label) {
    if (kitchenTimerInterval) clearInterval(kitchenTimerInterval);
    
    document.getElementById('kitchenTimer').style.display = 'flex';
    document.getElementById('timerLabel').innerText = label;
    
    let remaining = seconds;
    const elCountdown = document.getElementById('timerCountdown');
    
    const updateDisplay = () => {
        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        elCountdown.innerText = `${m}:${s}`;
    };
    
    updateDisplay();
    
    kitchenTimerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(kitchenTimerInterval);
            elCountdown.innerText = "00:00";
            document.getElementById('kitchenTimer').classList.add('timer-done');
            
            // Notify AI
            if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
                sendLiveText(`<system_event> timer_done: ${label} </system_event>`);
            }
        } else {
            updateDisplay();
        }
    }, 1000);
}

function stopTimer() {
    if (kitchenTimerInterval) {
        clearInterval(kitchenTimerInterval);
        kitchenTimerInterval = null;
    }
    document.getElementById('kitchenTimer').style.display = 'none';
    document.getElementById('kitchenTimer').classList.remove('timer-done');
}



/* ═══════════════════════════════════════════════════════════
   4. GEMINI LIVE API (WEB SOCKET + WEB AUDIO)
   ═══════════════════════════════════════════════════════════ */

async function toggleVoice() {
    if (isListening) {
        stopVoiceSession();
    } else {
        await startVoiceSession();
    }
}

async function startVoiceSession() {
    try {
        // 1. Get Microphone Access (16kHz for Gemini)
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
        });

        // 2. Setup Web Audio API
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(mediaStream);

        // ScriptProcessor is deprecated but widely supported and easiest for raw PCM extraction without AudioWorklets
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

        // 3. Setup WebSocket to backend
        voiceSocket = new WebSocket(WS_URL);

        voiceSocket.onopen = () => {
            isListening = true;
            elBtnVoice.classList.add("listening");
            elBtnVoice.innerHTML = `<span class="voice-icon">🛑</span><span class="voice-label">Stop Chef Aika</span>`;
            elWaveform.classList.add("active");
            elStatusDot.className = "status-dot listening";
            elStatusText.innerText = "Chef Aika is listening...";
            addTranscriptMessage("ai", "👩‍🍳 Connecting to kitchen audio...");
        };

        voiceSocket.onmessage = async (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === "connected") {
                addTranscriptMessage("ai", `👩‍🍳 ${msg.message}`);
                elStatusDot.className = "status-dot online";
                elStatusText.innerText = "Chef Aika is online";
            }
            else if (msg.type === "text") {
                addTranscriptMessage("ai", `👩‍🍳 ${msg.data}`);
            }
            else if (msg.type === "audio") {
                if (msg.data) {
                    playGeminiAudio(msg.data);
                }
                if (msg.final) {
                    // Turn complete
                    elStatusDot.className = "status-dot online";
                    elStatusText.innerText = "Chef Aika is online";
                } else {
                    elStatusDot.className = "status-dot listening";
                    elStatusText.innerText = "Chef Aika is speaking...";
                }
            }
            else if (msg.type === "tool_call") {
                console.log("Chef Aika invoked tool:", msg.tool);

                let result = "success";

                if (msg.tool === "generate_recipe_ui") {
                    showToast("Chef Aika is generating a recipe for you...");
                    addTranscriptMessage("ai", "👩‍🍳 Cooking it up in the UI right now!");
                    generateRecipe();
                }
                else if (msg.tool === "trigger_camera_scan") {
                    showToast("Chef Aika opened the camera scanner.");
                    addTranscriptMessage("ai", "👩‍🍳 Opening the camera so you can show me!");
                    startCamera();
                }
                else if (msg.tool === "set_kitchen_timer") {
                    const secs = msg.args.seconds || 60;
                    const label = msg.args.label || "Timer";
                    showToast(`Chef Aika set a timer for ${label}.`);
                    addTranscriptMessage("ai", `👩‍🍳 Setting a timer for ${label}!`);
                    startTimer(secs, label);
                }
                else if (msg.tool === "save_verbal_recipe") {
                    showToast("Recipe saved to your cookbook!");
                    addTranscriptMessage("ai", "👩‍🍳 I've saved that recipe to your cookbook.");
                    // The backend handles the actual Firestore saving
                }
                else if (msg.tool === "switch_to_ramsay_mode") {
                    showToast("Gordon Ramsay Mode Activated 🤬");
                    addTranscriptMessage("ai", "🤬 YOU CALL THAT COOKING?!");
                    document.getElementById('aikaAvatar').classList.add('ramsay-mode');
                    document.querySelector('.aika-name').innerText = "Chef Ramsay";
                    document.querySelector('.aika-name').style.color = "var(--warm-red)";
                    document.querySelector('.aika-tagline').innerText = "Idiot Sandwich Maker";
                    document.querySelector('.avatar-emoji').innerText = "🤬";
                }
                else if (msg.tool === "highlight_recipe_step") {
                    const stepText = msg.args.step_text;
                    if (stepText) highlightRecipeStep(stepText);
                }
                else {
                    result = "unsupported_tool";
                }

                // Let Gemini know we executed the tool
                if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
                    voiceSocket.send(JSON.stringify({
                        type: "tool_response",
                        tool: msg.tool,
                        call_id: msg.call_id,
                        result: result
                    }));
                }
            }
            else if (msg.type === "error") {
                showToast("AI Error: " + msg.message);
                stopVoiceSession();
            }
        };

        voiceSocket.onclose = () => {
            stopVoiceSession();
            addTranscriptMessage("ai", "👩‍🍳 Session ended. Bon appétit!");
        };

        // 4. Send Audio Chunks to backend
        audioProcessor.onaudioprocess = (e) => {
            if (!isListening || voiceSocket.readyState !== WebSocket.OPEN || isPlayingGeminiAudio) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16Data = float32ToPcm16(inputData);
            const base64Audio = arrayBufferToBase64(pcm16Data.buffer);

            voiceSocket.send(JSON.stringify({ type: "audio", data: base64Audio }));
        };

        // 5. Send Live Video Frames to backend (Ultimate Tweak)
        videoInterval = setInterval(() => {
            if (isListening && voiceSocket.readyState === WebSocket.OPEN && elCameraVideo.srcObject) {
                // Draw current video frame to canvas
                elCameraCanvas.width = elCameraVideo.videoWidth;
                elCameraCanvas.height = elCameraVideo.videoHeight;
                const ctx = elCameraCanvas.getContext('2d');
                ctx.drawImage(elCameraVideo, 0, 0);

                // Get JPEG base64 string
                const dataUrl = elCameraCanvas.toDataURL('image/jpeg', 0.5); // High compression
                const base64Image = dataUrl.split(',')[1];

                // Send over WebSocket
                voiceSocket.send(JSON.stringify({ type: "image", data: base64Image }));
            }
        }, 2000); // 1 frame every 2 seconds is enough for Gemini Live API

        source.connect(audioProcessor);
        audioProcessor.connect(audioContext.destination);

    } catch (err) {
        console.error("Microphone setup failed:", err);
        showToast("Could not access microphone.");
    }
}

function stopVoiceSession() {
    isListening = false;

    if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
        voiceSocket.send(JSON.stringify({ type: "end_session" }));
        voiceSocket.close();
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }

    if (videoInterval) {
        clearInterval(videoInterval);
        videoInterval = null;
    }

    elBtnVoice.classList.remove("listening");
    elBtnVoice.innerHTML = `<span class="voice-icon">🎤</span><span class="voice-label">Talk to Chef Aika</span>`;
    elWaveform.classList.remove("active");
    elStatusDot.className = "status-dot";
    elStatusText.innerText = "Chef Aika is offline";
}

function sendLiveText(text) {
    if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
        voiceSocket.send(JSON.stringify({ type: "text", data: text }));
    }
}

// ── Audio Utils ───────────────────────────────────────────

function float32ToPcm16(floatData) {
    const pcmData = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
        const s = Math.max(-1, Math.min(1, floatData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcmData;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
    return bytes.buffer;
}

async function playGeminiAudio(base64Audio) {
    if (!audioContext) return;
    isPlayingGeminiAudio = true; // Pause mic processing while speaking

    try {
        const arrayBuffer = base64ToArrayBuffer(base64Audio);

        // The Gemini Live API returns raw 24kHz PCM 16-bit mono audio
        // We need to wrap it in a WAV header for the browser AudioContext to decode it
        const wavBuffer = createWavHeader(arrayBuffer, 24000, 1, 16);

        const audioBuffer = await audioContext.decodeAudioData(wavBuffer);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        source.onended = () => { isPlayingGeminiAudio = false; };
        source.start(0);

    } catch (err) {
        console.error("Error playing audio chunk:", err);
        isPlayingGeminiAudio = false;
    }
}

// Wraps raw PCM data from Gemini into a WAV file format that AudioContext can read
function createWavHeader(pcmBuffer, sampleRate, numChannels, bitsPerSample) {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // "RIFF" chunk
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);   // size
    view.setUint16(20, 1, true);    // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM data payload
    const pcmArray = new Uint8Array(pcmBuffer);
    const outArray = new Uint8Array(buffer, 44);
    outArray.set(pcmArray);

    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// ── UI Utils ──────────────────────────────────────────────

function highlightRecipeStep(stepText) {
    const steps = document.querySelectorAll("#recipeSteps li");
    const lowerTarget = stepText.toLowerCase().trim();
    
    steps.forEach(li => {
        const lowerLi = li.innerText.toLowerCase().trim();
        // Match if one string contains the other, or matches first few words
        if (lowerLi.includes(lowerTarget) || lowerTarget.includes(lowerLi) || 
            (lowerTarget.length > 15 && lowerLi.substring(0, 15) === lowerTarget.substring(0, 15))) {
            li.style.backgroundColor = 'rgba(212, 151, 58, 0.2)'; // Gold highlight
            li.style.transform = 'scale(1.03)';
            li.style.transition = 'all 0.3s ease';
            li.style.boxShadow = '0 0 15px rgba(212, 151, 58, 0.3)';
            li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            li.style.backgroundColor = 'var(--warm-card)';
            li.style.transform = 'scale(1)';
            li.style.boxShadow = 'none';
        }
    });
}

function addTranscriptMessage(sender, text) {
    const div = document.createElement("div");
    div.className = `transcript-message ${sender}`;
    div.innerHTML = `<span>${text}</span>`;
    elTranscriptBox.appendChild(div);
    elTranscriptBox.scrollTop = elTranscriptBox.scrollHeight;
}

function showToast(msg) {
    elToast.innerText = msg;
    elToast.classList.add("show");
    setTimeout(() => { elToast.classList.remove("show"); }, 3000);
}

// Initialization
renderIngredients();
displayRecipe({
    name: "Scan fridge to begin",
    description: "I'll create a magical recipe based on what you have.",
    ingredients_used: [], instructions: [], servings: 2, prep_time: null, cook_time: null
});
