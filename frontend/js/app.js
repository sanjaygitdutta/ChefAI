/* ═══════════════════════════════════════════════════════════
   Fridge Chef AI — Frontend Application Logic
   ═══════════════════════════════════════════════════════════ */

const API_BASE = "/api/v1";
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/live`;

// ── Firebase Configuration ─────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCnaopJUs7z9wXKmq_BW-bwmxOjAIW_aE4",
  authDomain: "chefai-acb78.firebaseapp.com",
  projectId: "chefai-acb78",
  storageBucket: "chefai-acb78.firebasestorage.app",
  messagingSenderId: "98705917043",
  appId: "1:98705917043:web:5a18592944a130730f1606",
  measurementId: "G-QLDLDN52KB"
};

// Initialize Firebase App
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ── State ──────────────────────────────────────────────────
let ingredients = [];
let voiceSocket = null;
let audioContext = null;      // Recording context (mic capture)
let playbackCtx = null;       // Playback context (Gemini output)
let nextPlayTime = 0;         // For sequential audio scheduling
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

    // Display the image preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
        elCameraPreview.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius);" />`;
        if (elCameraOverlay) elCameraOverlay.style.display = 'none';
        if (elCameraVideo) elCameraVideo.style.display = 'none';
    };
    reader.readAsDataURL(file);

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

            if (document.querySelector('.aika-status')?.textContent.includes('online')) {
                sendVoiceText(`I just showed you my fridge. I now have ${ingredients.length} ingredients loaded.`);
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

// Called when Aika triggers generate_recipe_ui via voice.
// If the UI ingredients list is empty (user described ingredients verbally),
// we scrape them from the chat transcript and auto-add them first.
async function generateRecipeFromVoice() {
    if (ingredients.length === 0) {
        // Try to extract ingredients from the last user message in the transcript
        const userMessages = elTranscriptBox.querySelectorAll('.transcript-message.user span');
        let detected = [];
        if (userMessages.length > 0) {
            const lastMsg = userMessages[userMessages.length - 1].innerText.replace(/^🎤\s*/, '').toLowerCase();
            // Simple extraction: look for keywords like "have X, Y and Z" or "egg, cheese, tomato"
            const match = lastMsg.match(/(?:have|got|with|using)?\s*(.+?)(?:\s*(?:what|can|and)\s*(I|i)\s*(?:cook|make|prepare))?$/i);
            if (match && match[1]) {
                const raw = match[1].replace(/\s+and\s+/gi, ',').split(/[,]+/);
                detected = raw.map(s => s.trim()).filter(s => s.length > 1 && s.length < 30);
            }
        }

        if (detected.length > 0) {
            detected.forEach(name => {
                const cap = name.charAt(0).toUpperCase() + name.slice(1);
                if (!ingredients.some(i => i.name.toLowerCase() === name)) {
                    ingredients.push({ name: cap });
                }
            });
            renderIngredients();
            addTranscriptMessage('ai', `👩‍🍳 Auto-detected ingredients: ${detected.join(', ')}. Generating recipe...`);
        } else {
            // If extraction failed, show a toast and ask user to add ingredients manually
            showToast("Please add your ingredients to the list so I can generate a recipe!");
            return;
        }
    }
    generateRecipe();
}

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

        // If live voice is connected, tell Aika we generated a recipe and ask her to read it
        if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
            sendVoiceText(`I just generated a recipe called ${recipe.name}. Here are the instructions please read them out loud to me naturally and enthusiastically: ${recipe.instructions.join(' ')}`);
        } else {
            // Fallback: auto-read using browser TTS if voice session isn't active
            setTimeout(readRecipeAloud, 500);
        }
        
        // Critical: Unlock the microphone immediately so the user can speak again
        // even if Aika decides to stay silent about the recipe.
        window._isAikaThinking = false;
        
        // --- NEW: Save directly to Firebase from Frontend ---
        try {
            await db.collection("recipes").add({
                name: recipe.name,
                description: recipe.description,
                ingredients_used: recipe.ingredients_used,
                instructions: recipe.instructions,
                servings: recipe.servings,
                prep_time: recipe.prep_time,
                cook_time: recipe.cook_time,
                dietary_restrictions: payload.dietary_restrictions,
                created_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("Recipe saved directly to Firebase from the web app!");
        } catch(fbErr) {
            console.error("Firebase save failed:", fbErr);
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
        sendVoiceText(`Please read me the following recipe steps aloud: ${textToRead}`);
    } else {
        // Fallback to browser TTS if Live API not connected
        const utterance = new SpeechSynthesisUtterance(textToRead);
        
        // Try to find a female English voice (Zira on Windows, Samantha on Mac, or Google's female voices)
        const voices = window.speechSynthesis.getVoices();
        const femaleVoice = voices.find(v => 
            v.lang.startsWith('en') && 
            (v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Google US English'))
        ) || voices.find(v => v.lang.startsWith('en'));
        
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

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
                sendVoiceText(`<system_event> timer_done: ${label} </system_event>`);
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
        // STEP 1: Create the playback AudioContext SYNCHRONOUSLY during button click!
        // Required by browsers — must happen before any await or it gets suspended/muted.
        playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        nextPlayTime = 0;
        if (playbackCtx.state === 'suspended') {
            await playbackCtx.resume();
        }

        // STEP 2: Connect WebSocket to backend
        voiceSocket = new WebSocket(WS_URL);

        voiceSocket.onopen = () => {
            isListening = true;
            console.log('[Aika] WebSocket open.');

            elBtnVoice.classList.add("listening");
            elBtnVoice.innerHTML = `<span class="voice-icon">🛑</span><span class="voice-label">Stop Chef Aika</span>`;
            elWaveform.classList.add("active");
            elStatusDot.className = "status-dot listening";
            elStatusText.innerText = "Chef Aika is listening...";
            addTranscriptMessage("ai", "👩‍🍳 Connecting to kitchen audio...");

            const textRow = document.getElementById('voiceTextRow');
            if (textRow) textRow.style.display = 'flex';

            // STEP 3: Use browser's native SpeechRecognition API for voice-to-text
            // This is 100% reliable and bypasses all audio format / VAD issues
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                showToast("Voice recognition not supported in this browser. Please use Chrome or Edge.");
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.continuous = true;       // Keep listening
            recognition.interimResults = false;   // Only final results

            recognition.onresult = (event) => {
                const result = event.results[event.results.length - 1];
                if (result.isFinal) {
                    const transcript = result[0].transcript.trim();
                    if (!transcript) return;

                    // Prevent turn collision if Aika is already responding
                    if (window._isAikaThinking) {
                        console.log('[Aika] Ignoring speech (still thinking):', transcript);
                        return;
                    }

                    console.log('[Aika] Heard:', transcript);
                    addTranscriptMessage('user', `🎤 ${transcript}`);
                    elStatusDot.className = "status-dot listening";
                    elStatusText.innerText = "Chef Aika is thinking...";
                    window._isAikaThinking = true;

                    // Send transcribed text to Aika via WebSocket
                    if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
                        voiceSocket.send(JSON.stringify({ type: 'text', data: transcript }));
                    }
                }
            };

            recognition.onerror = (e) => {
                if (e.error === 'no-speech') return; // Normal — just silence
                console.warn('[Aika] Speech recognition error:', e.error);
            };

            recognition.onend = () => {
                // Auto-restart so it keeps listening continuously
                if (isListening) {
                    try { recognition.start(); } catch (_) {}
                }
            };

            recognition.start();
            console.log('[Aika] Speech recognition started!');

            // Store reference so we can stop it later
            window._aikaRecognition = recognition;
        };

        voiceSocket.onmessage = async (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === "connected") {
                addTranscriptMessage("ai", `👩‍🍳 ${msg.message}`);
                elStatusDot.className = "status-dot online";
                elStatusText.innerText = "Chef Aika is online";
                window._isAikaThinking = false;
            }
            else if (msg.type === "text") {
                let text = msg.data;
                
                // --- Ramsay Mode detection ---
                const avatar = document.querySelector('.aika-avatar');
                if (text.includes('<angry>')) {
                    if (avatar) avatar.classList.add('ramsay-mode');
                }
                if (text.includes('</angry>')) {
                    if (avatar) avatar.classList.remove('ramsay-mode');
                }
                
                // Remove tags from the user-facing transcript
                text = text.replace(/<angry>/g, '').replace(/<\/angry>/g, '');
                
                addTranscriptMessage("ai", `👩‍🍳 ${text}`);
            }
            else if (msg.type === "audio") {
                if (msg.data) {
                    scheduleGeminiAudio(msg.data);
                }
                if (msg.final) {
                    elStatusDot.className = "status-dot online";
                    elStatusText.innerText = "Chef Aika is online";
                    window._isAikaThinking = false; // Response finished!
                } else {
                    elStatusDot.className = "status-dot listening";
                    elStatusText.innerText = "Chef Aika is speaking...";
                }
            }
            else if (msg.type === "error") {
                showToast("AI Error: " + msg.message);
                window._isAikaThinking = false;
                stopVoiceSession();
            }
            else if (msg.type === "tool_call") {
                console.log(`[Aika] Executing tool: ${msg.name}`, msg.args);
                window._isAikaThinking = false; // Reset listening state so user can speak!
                
                if (msg.name === "trigger_camera_scan") {
                    startCamera();
                } 
                else if (msg.name === "generate_recipe_ui") {
                    generateRecipeFromVoice();
                }
                else if (msg.name === "set_kitchen_timer") {
                    startTimer(msg.args.seconds, msg.args.label);
                }
                else if (msg.name === "highlight_recipe_step") {
                    highlightRecipeStep(msg.args.step_text);
                }
            }
        };

        voiceSocket.onclose = () => {
            stopVoiceSession();
            addTranscriptMessage("ai", "👩‍🍳 Session ended. Bon appétit!");
            const textRow = document.getElementById('voiceTextRow');
            if (textRow) textRow.style.display = 'none';
        };

        voiceSocket.onerror = (err) => {
            console.error('[Aika] WebSocket error:', err);
            showToast("Connection error. Please try again.");
            stopVoiceSession();
        };

    } catch (err) {
        console.error("Voice session failed:", err);
        showToast("Could not start voice session. Please try again.");
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

    if (playbackCtx && playbackCtx.state !== 'closed') {
        playbackCtx.close();
        playbackCtx = null;
    }
    nextPlayTime = 0;

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

function sendTextToAika() {
    const input = document.getElementById('voiceTextInput');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    if (voiceSocket && voiceSocket.readyState === WebSocket.OPEN) {
        addTranscriptMessage('user', `👤 ${text}`);
        voiceSocket.send(JSON.stringify({ type: 'text', data: text }));
    } else {
        showToast('Start a voice session first!');
    }
}

// Enter key support for text input
const voiceTextInputEl = document.getElementById('voiceTextInput');
if (voiceTextInputEl) {
    voiceTextInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendTextToAika();
    });
}

function sendVoiceText(text) {
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

// Downsample float32 audio from inputRate to outputRate using linear interpolation
function downsample(buffer, inputRate, outputRate) {
    if (inputRate === outputRate) return buffer;
    const ratio = inputRate / outputRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const pos = i * ratio;
        const index = Math.floor(pos);
        const frac = pos - index;
        const a = buffer[index] || 0;
        const b = buffer[index + 1] || 0;
        result[i] = a + frac * (b - a);
    }
    return result;
}

// Proper anti-aliased downsampling to 16kHz using box-filter averaging
// Averages every N input samples into 1 output sample — eliminates aliasing distortion
function downsampleTo16k(inputBuffer, inputRate) {
    const TARGET_RATE = 16000;
    if (inputRate === TARGET_RATE) return inputBuffer;

    // ratio must be integer-ish for best quality (48000/16000 = 3)
    const ratio = inputRate / TARGET_RATE;
    const outputLength = Math.floor(inputBuffer.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(Math.floor((i + 1) * ratio), inputBuffer.length);
        let sum = 0;
        for (let j = start; j < end; j++) {
            sum += inputBuffer[j];
        }
        output[i] = sum / (end - start);
    }
    return output;
}

// Schedule Gemini audio chunks sequentially using one shared playbackCtx
function scheduleGeminiAudio(base64Audio) {
    if (!playbackCtx) {
        console.warn('[Aika] No playbackCtx — cannot play audio!');
        return;
    }

    // CRITICAL: Resume suspended AudioContext. Browsers auto-suspend after inactivity.
    if (playbackCtx.state === 'suspended') {
        console.log('[Aika] Resuming suspended playbackCtx...');
        playbackCtx.resume();
    }

    try {
        const arrayBuffer = base64ToArrayBuffer(base64Audio);
        
        // Convert raw 16-bit PCM (from Gemini) to Float32 for Web Audio API manually.
        const pcm16 = new Int16Array(arrayBuffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768.0;
        }

        const audioBuffer = playbackCtx.createBuffer(1, float32.length, 24000);
        audioBuffer.getChannelData(0).set(float32);

        const source = playbackCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackCtx.destination);

        const currentTime = playbackCtx.currentTime;
        if (nextPlayTime < currentTime) {
            nextPlayTime = currentTime + 0.05;
        }
        
        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
        console.log(`[Aika] Scheduled audio: ${pcm16.length} samples, ctx state=${playbackCtx.state}`);

    } catch (err) {
        console.error('[Aika] Error scheduling audio chunk:', err);
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
