/**
 * Zenith Assistant - Renderer Process Script (script.js) V1.6.1
 * Includes: Settings Panel, Themes, Auto-Send Toggle, Adv Search, Clipboard, Notes, Context, Code Copy, Backend Status, Fixes
 */

// --- DOM Elements ---
const queryInput = document.getElementById('query-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const webcamButton = document.getElementById('webcam-button');
const clipboardButton = document.getElementById('clipboard-button');
const chatContainer = document.getElementById('chat-container');
const statusIndicator = document.getElementById('status-indicator');
const connectionStatusDot = document.getElementById('connection-status');
const minimizeBtn = document.getElementById('minimize-btn');
const maximizeBtn = document.getElementById('maximize-btn');
const closeBtn = document.getElementById('close-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const stopButton = document.getElementById('stop-button');
const videoElement = document.getElementById('webcam-video');
const canvasElement = document.getElementById('webcam-canvas');
const interactionArea = document.querySelector('.interaction-area');
// Settings Panel Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const themeOptionBtns = document.querySelectorAll('.theme-options .theme-btn');
const clearAppsBtn = document.getElementById('clear-apps-btn'); // Placeholder action button
const autoSendToggle = document.getElementById('auto-send-toggle'); // Auto-send setting

// --- Constants ---
const PYTHON_BACKEND_URL = 'http://127.0.0.1:5111';
const CHAT_HISTORY_KEY = 'zenithAssistantChatHistory';
const THEME_STORAGE_KEY = 'zenith-theme';
const AUTO_SEND_VOICE_KEY = 'zenith-autoSendVoice';
const PING_INTERVAL = 5000; // ms
const CONTEXT_MESSAGE_COUNT = 6; // Number of messages (3 user + 3 assistant) for context

// --- State Variables ---
let isListening = false;
let isGenerating = false;
let isWebcamActive = false;
let currentWebcamStream = null;
let currentAssistantMessageElement = null; // Holds the DOM element being streamed into
let chatHistory = [];
let abortController = null;
let awaitingAppPathFor = null; // Holds name of app needing path input
let backendConnected = false;
let pingIntervalId = null;
let autoSendVoiceInput = true; // Default value, loaded from storage

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Zenith UI Initializing...");
    loadAndApplyTheme(); // Load theme first
    loadSettings();      // Load other preferences
    setupEventListeners();
    loadChatHistory();   // Load past messages
    renderChatHistory(); // Display loaded history or initial message
    autoResizeTextarea.call(queryInput); // Adjust input size
    configureMarked();   // Setup Markdown library
    startBackendPing();  // Start monitoring backend connection
    updateActiveThemeButton(); // Ensure correct theme button is highlighted
});

// --- Electron Window Ready Signal Handler ---
window.electronAPI.onWindowReady(() => {
    document.body.classList.add('loaded'); // Trigger entry animation
    setTimeout(() => queryInput?.focus(), 150); // Focus input after animation settles, check if exists
});

// --- Configure Marked.js ---
function configureMarked() {
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        console.log("Marked.js configured.");
    } else { console.error("Marked library failed to load."); }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    minimizeBtn?.addEventListener('click', () => window.electronAPI.minimizeApp());
    maximizeBtn?.addEventListener('click', () => window.electronAPI.maximizeApp());
    closeBtn?.addEventListener('click', () => window.electronAPI.closeApp());
    clearChatBtn?.addEventListener('click', clearChat);
    queryInput?.addEventListener('input', autoResizeTextarea);
    queryInput?.addEventListener('keypress', handleInputKeypress);
    sendButton?.addEventListener('click', handleSendQuery);
    micButton?.addEventListener('click', handleMicToggle);
    webcamButton?.addEventListener('click', handleWebcamToggle);
    clipboardButton?.addEventListener('click', handleClipboardRead);
    stopButton?.addEventListener('click', handleStopGeneration);
    settingsBtn?.addEventListener('click', toggleSettingsPanel);
    settingsCloseBtn?.addEventListener('click', toggleSettingsPanel);
    settingsOverlay?.addEventListener('click', toggleSettingsPanel);
    themeOptionBtns.forEach(btn => btn.addEventListener('click', handleThemeButtonClick));
    autoSendToggle?.addEventListener('change', handleAutoSendToggleChange);
    clearAppsBtn?.addEventListener('click', handleClearKnownApps);
    chatContainer.addEventListener('click', (event) => { if (event.target?.classList.contains('copy-code-btn')) handleCodeCopy(event.target); });
    console.log("UI Event listeners attached.");
}

// --- Backend Connection Check ---
async function pingBackend() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout
        const response = await fetch(`${PYTHON_BACKEND_URL}/ping`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'ok' && !backendConnected) { console.log("Backend connection established."); backendConnected = true; updateConnectionStatusUI(true); }
            else if (response.ok && backendConnected) { backendConnected = true; updateConnectionStatusUI(true); } // Still connected
        } else { throw new Error(`Ping fail: ${response.status}`); }
    } catch (error) {
        if (error.name !== 'AbortError' && backendConnected) { console.warn("Backend connection lost.", error.message); backendConnected = false; updateConnectionStatusUI(false); }
        else if (!backendConnected) { backendConnected = false; updateConnectionStatusUI(false); } // Ensure UI reflects disconnected
    }
}
function startBackendPing() { pingBackend(); if(pingIntervalId) clearInterval(pingIntervalId); pingIntervalId = setInterval(pingBackend, PING_INTERVAL); }
function updateConnectionStatusUI(isConnected) {
    if(connectionStatusDot) { connectionStatusDot.classList.toggle('connected',isConnected); connectionStatusDot.classList.toggle('disconnected',!isConnected); connectionStatusDot.title = isConnected ? "Backend Connected" : "Backend Disconnected"; }
    // Refresh input states based on connection status
    setGeneratingState(isGenerating, awaitingAppPathFor);
}

// --- Settings Panel ---
function toggleSettingsPanel() { const isVisible = settingsPanel.classList.contains('visible'); if (!isVisible) updateActiveThemeButton(); settingsPanel.classList.toggle('visible'); settingsOverlay.classList.toggle('visible'); }

// --- Theme Management ---
function handleThemeButtonClick(event) { const theme = event.target.getAttribute('data-theme'); applyTheme(theme); updateActiveThemeButton(theme); }
function applyTheme(themeName = 'glass') { console.log(`Applying theme: ${themeName}`); document.documentElement.setAttribute('data-theme', themeName); try{localStorage.setItem(THEME_STORAGE_KEY, themeName);}catch(e){console.error("Save theme fail:", e);} }
function loadAndApplyTheme() { let theme = 'glass'; try{theme=localStorage.getItem(THEME_STORAGE_KEY) || 'glass';}catch(e){} applyTheme(theme); }
function updateActiveThemeButton(activeTheme = null) { const theme = activeTheme || document.documentElement.getAttribute('data-theme') || 'glass'; themeOptionBtns.forEach(btn => { btn.classList.toggle('active', btn.getAttribute('data-theme') === theme); }); }

// --- Settings Load/Save ---
function loadSettings() { try{ const saved = localStorage.getItem(AUTO_SEND_VOICE_KEY); autoSendVoiceInput = saved !== null ? (saved === 'true') : true; }catch(e){ autoSendVoiceInput=true; } if(autoSendToggle) autoSendToggle.checked = autoSendVoiceInput; console.log(`Settings loaded: Auto-send=${autoSendVoiceInput}`); }
function handleAutoSendToggleChange(event) { autoSendVoiceInput = event.target.checked; console.log(`Auto-send voice set to: ${autoSendVoiceInput}`); try{ localStorage.setItem(AUTO_SEND_VOICE_KEY, autoSendVoiceInput); }catch(e){ console.error("Save auto-send fail:", e); } }
function handleClearKnownApps() { console.warn("Clear Known Apps - Placeholder."); showStatus("Clear Apps N/A", 3000); toggleSettingsPanel(); }


// --- Core UI Functions ---
function autoResizeTextarea(){ this.style.height='auto'; this.style.height=Math.min(this.scrollHeight, 120)+'px'; if(chatContainer.scrollHeight-chatContainer.clientHeight<=chatContainer.scrollTop+60) scrollToBottom(); }
function handleInputKeypress(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleSendQuery(); }}
function scrollToBottom(){ chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' }); } // Smooth scroll
function showStatus(m, d=3000){ statusIndicator.textContent=m; statusIndicator.classList.add('show'); clearTimeout(statusIndicator.timer); statusIndicator.timer=setTimeout(()=>statusIndicator.classList.remove('show'), d); }
function setGeneratingState(generating, isAwaitingInput = false) {
    const trulyGenerating = generating && !isAwaitingInput; isGenerating = trulyGenerating;
    stopButton.classList.toggle('hidden', !trulyGenerating);
    const disableUI = generating || isAwaitingInput || !backendConnected; // Determine overall disabled state
    // Set disabled property on all interactive elements
    queryInput.disabled = disableUI; sendButton.disabled = disableUI; micButton.disabled = disableUI; webcamButton.disabled = disableUI; clipboardButton.disabled = disableUI;
    // Apply CSS classes for visual feedback
    interactionArea.classList.toggle('generating', trulyGenerating); interactionArea.classList.toggle('awaiting-input', isAwaitingInput);
    // Update placeholder text dynamically
    if (!isAwaitingInput) queryInput.placeholder = backendConnected ? "Ask Zenith anything..." : "Connecting...";
}

// --- Chat History ---
function loadChatHistory() { try{ const s=localStorage.getItem(CHAT_HISTORY_KEY); if(s) chatHistory=JSON.parse(s); console.log(`Loaded ${chatHistory.length} history.`); } catch(e){ console.error("History load err:",e); chatHistory=[]; localStorage.removeItem(CHAT_HISTORY_KEY); } if(chatHistory.length === 0) addMessageToHistory('assistant', 'Hello! I am Zenith ✨. How can I help you today?'); }
function saveChatHistory() { try{ localStorage.setItem(CHAT_HISTORY_KEY,JSON.stringify(chatHistory)); } catch(e){ console.error("Hist save err:",e); showStatus("Err saving hist", 4000); }}
function addMessageToHistory(sender, content, type = 'text', imageUrl = null) { const message={sender,content,type}; if(type==='image'&&imageUrl) message.imageUrl=imageUrl; chatHistory.push(message); saveChatHistory(); return message; }
function renderChatHistory() { chatContainer.innerHTML=''; chatHistory.forEach(msg=>renderMessage(msg.sender, msg.content, msg.imageUrl, msg.type==='error')); scrollToBottom(); }
function clearChat() { chatHistory=[]; addMessageToHistory('assistant', 'Chat cleared. Ready for your next question!'); renderChatHistory(); queryInput.value=''; autoResizeTextarea.call(queryInput); showStatus("Chat cleared"); if(awaitingAppPathFor){ awaitingAppPathFor=null; setGeneratingState(false,false); } }

// --- Message Rendering ---
function renderMessage(sender, content, imageUrl = null, isError = false) {
    const messageElement = document.createElement('div'); messageElement.classList.add('message', sender); if (isError) messageElement.classList.add('error');
    const span = document.createElement('span');
    // Only parse Markdown for assistant messages that aren't errors
    if (sender === 'assistant' && !isError && typeof marked !== 'undefined') { try{ span.innerHTML=marked.parse(content); } catch(e){ console.error("Markdown error:", e); span.textContent=content; } }
    else { span.textContent=content; } // Render user messages & errors as plain text
    messageElement.appendChild(span);
    if (imageUrl) { const img=document.createElement('img'); img.src=imageUrl; img.alt="Image content"; messageElement.appendChild(img); }
    chatContainer.appendChild(messageElement); // Add message to DOM
    // Add Copy Buttons *after* rendering Markdown and appending to DOM
    span.querySelectorAll('pre').forEach(pre => { if(!pre.querySelector('.copy-code-btn')){ const btn=document.createElement('button'); btn.textContent='Copy'; btn.className='copy-code-btn'; btn.title='Copy code snippet'; pre.style.position='relative'; pre.appendChild(btn); }});
    scrollToBottom(); return messageElement;
}
function handleCodeCopy(button) { const pre=button.closest('pre'); const code=pre?.querySelector('code'); if(code){ navigator.clipboard.writeText(code.textContent).then(()=>{ button.textContent='Copied!'; setTimeout(()=>button.textContent='Copy', 1500); }).catch(err=>{ console.error('Copy fail:',err); showStatus("Copy failed", 2000); }); } }

// --- Unified Send Handler ---
function handleSendQuery() {
    const userInput = queryInput.value.trim();
    if (!userInput || !backendConnected) { showStatus(backendConnected ? "Please type a message." : "Backend not connected.", 2000); return; }
    const currentAwaitingApp = awaitingAppPathFor;
    // Clear input AFTER processing, not before, especially for auto-send case.
    // queryInput.value = '';
    // autoResizeTextarea.call(queryInput);
    queryInput.focus(); // Keep focus

    if (currentAwaitingApp) { // Sending app path
        renderMessage('user', `Path for ${currentAwaitingApp}:\n\`${userInput}\``);
        addMessageToHistory('user', `Provided path for ${currentAwaitingApp}: ${userInput}`);
        queryInput.value = ''; autoResizeTextarea.call(queryInput); // Clear *after* processing
        sendAppPathToBackend(currentAwaitingApp, userInput);
        awaitingAppPathFor = null; setGeneratingState(false, false);
    } else if (!isGenerating && !isListening) { // Sending normal query/command
        addMessageToHistory('user', userInput); renderMessage('user', userInput);
        queryInput.value = ''; autoResizeTextarea.call(queryInput); // Clear *after* processing
        processQueryOrCommand(userInput, false);
    }
}


// --- Process Query/Command/Clipboard ---
async function processQueryOrCommand(inputText, isClipboard = false) {
    setGeneratingState(true, false); abortController = new AbortController();
    // Create placeholder message immediately
    currentAssistantMessageElement = renderMessage('assistant', '', null, false); currentAssistantMessageElement.classList.add('thinking');
    const contentSpan = currentAssistantMessageElement?.querySelector('span'); if(contentSpan) contentSpan.textContent='';
    const endpoint = isClipboard ? '/process_clipboard' : '/ask_stream';
    const payload = { history: chatHistory.slice(-CONTEXT_MESSAGE_COUNT) }; // Use constant for history length
    if(isClipboard) { payload.text = inputText; } else { payload.query = inputText; }

    try {
        const response = await fetch(`${PYTHON_BACKEND_URL}${endpoint}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:abortController.signal });
        const contentType = response.headers.get("content-type");
        currentAssistantMessageElement?.classList.remove('thinking'); // Remove thinking animation

        if (contentType?.includes("application/json")) { // Command handled by backend
             const data = await response.json(); console.log("JSON Response:", data);
             if(!response.ok) throw new Error(data.error || `Req Fail: ${response.status}`);
             if(data.status === "handled" || data.status === "success") { if(contentSpan) contentSpan.innerHTML=marked.parse(data.response); addMessageToHistory('assistant', data.response); }
             else if(data.status === "app_not_found") { awaitingAppPathFor = data.app_name; setGeneratingState(false, true); const msg=data.error_hint?`${data.error_hint}\n`:""; const pTxt=`${msg}Path for **${data.app_name}**?`; if(contentSpan) contentSpan.innerHTML=marked.parse(pTxt); addMessageToHistory('assistant', pTxt); queryInput.placeholder=`Enter full path for ${data.app_name}...`; return; }
             else throw new Error(data.response || data.error || "Unknown JSON response");
        } else if (contentType?.includes("text/plain")) { // Gemini stream response
            await processStreamResponse(response.body, contentSpan);
        } else { throw new Error(`Unexpected response type: ${contentType}`); }
    } catch (error) { handleFetchError(error, isClipboard ? "clipboard proc" : "query/command");
    } finally { if (!awaitingAppPathFor) { setGeneratingState(false, false); currentAssistantMessageElement = null; abortController = null; } }
}
async function processStreamResponse(responseBody, contentSpan) {
    let accumulated=""; const reader=responseBody.getReader(); const decoder=new TextDecoder();
    try{ while(true){ const{done,value}=await reader.read(); if(done)break; const chunk=decoder.decode(value,{stream:true}); const lines=chunk.split('\n'); for(const line of lines){ if(line.startsWith("ERROR:")){ const eMsg=line.substring(6).trim(); console.error("Backend Stream Error:",eMsg); if(currentAssistantMessageElement)currentAssistantMessageElement.remove(); renderMessage('assistant',`Stream Error: ${eMsg}`,null,true); addMessageToHistory('assistant',`Stream Error: ${eMsg}`,'error'); currentAssistantMessageElement=null; throw new Error(eMsg); } else if(line){ accumulated+=line; if(contentSpan){contentSpan.innerHTML=marked.parse(accumulated); scrollToBottom();}}}} if(currentAssistantMessageElement)addMessageToHistory('assistant',accumulated);} catch(streamError){console.error("Stream Error:",streamError);throw streamError;}
}

// --- Send App Path ---
async function sendAppPathToBackend(appName, appPath) {
    setGeneratingState(true,false); let tempMsg=renderMessage('assistant', `Saving path...`, null, false); tempMsg.classList.add('thinking');
    try{ const response=await fetch(`${PYTHON_BACKEND_URL}/add_app`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_name:appName,app_path:appPath})}); tempMsg?.remove(); const data=await response.json(); if(!response.ok)throw new Error(data.error || `Add fail`); renderMessage('assistant',data.response); addMessageToHistory('assistant',data.response);}
    catch(error){ tempMsg?.remove(); handleFetchError(error,"saving path");}
    finally{ setGeneratingState(false,false); awaitingAppPathFor=null; }
}

// --- Fetch Error Handler ---
function handleFetchError(error, context="request") {
    if(error.name === 'AbortError'){ console.log(`Fetch aborted: ${context}`); showStatus('Stopped.', 2000); if(currentAssistantMessageElement){ const s=currentAssistantMessageElement.querySelector('span'); if(s?.textContent?.trim()){ s.innerHTML+=marked.parse("\n*(Stopped)*"); addMessageToHistory('assistant',s.textContent); }else{ currentAssistantMessageElement.remove(); }}}
    else{ console.error(`Error ${context}:`, error); currentAssistantMessageElement?.remove(); renderMessage('assistant', `Error: ${error.message}`, null, true); addMessageToHistory('assistant', `Error: ${error.message}`, 'error'); }
}

// --- Clipboard Handler ---
async function handleClipboardRead() {
    if(isGenerating||isListening||awaitingAppPathFor||!backendConnected) return;
    try { const text = await window.electronAPI.readClipboard(); if(!text?.trim()){showStatus("Clipboard empty.",2000); return;} renderMessage('user',`Clipboard Content:\n\`\`\`\n${text.substring(0,200)}${text.length > 200 ? '...' : ''}\n\`\`\``); addMessageToHistory('user', `Read clipboard:\n${text}`); processQueryOrCommand(text, true); } // Mark as clipboard
    catch(e){ handleFetchError(e, "reading clipboard"); }
}

// --- Image Analysis ---
async function sendImageAnalysisQuery(query, imageDataURL) {
    if(isGenerating||isListening||awaitingAppPathFor||!backendConnected) return;
    addMessageToHistory('user',query,'image',imageDataURL); renderMessage('user',query,imageDataURL);
    setGeneratingState(true,false); currentAssistantMessageElement=renderMessage('assistant','',null,false); currentAssistantMessageElement.classList.add('thinking'); abortController=new AbortController();
    try { const payload = {query:query,image_data:imageDataURL /* history omitted */};
        const response=await fetch(`${PYTHON_BACKEND_URL}/analyze_image`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:abortController.signal});
        currentAssistantMessageElement?.classList.remove('thinking'); const data=await response.json(); if(!response.ok) throw new Error(data.error || `Image fail`);
        const responseText = data.response || "Could not analyze image."; if(currentAssistantMessageElement) currentAssistantMessageElement.querySelector('span').innerHTML=marked.parse(responseText); else currentAssistantMessageElement = renderMessage('assistant', responseText); addMessageToHistory('assistant',responseText);
    } catch(error){ handleFetchError(error, "image analysis");
    } finally { if(!awaitingAppPathFor) { setGeneratingState(false, false); currentAssistantMessageElement=null; abortController=null; } }
}

// --- Stop Button ---
function handleStopGeneration() { if(isGenerating && abortController) abortController.abort(); }

// --- Speech Recognition Handler (FIXED for auto-send display) ---
async function handleMicToggle() {
    if(isGenerating||awaitingAppPathFor||!backendConnected) return; if(isListening) return;
    isListening=true; micButton.classList.add('listening'); micButton.disabled=true; disableOtherInputs(true); showStatus("Listening...", 5000);
    try { const response=await fetch(`${PYTHON_BACKEND_URL}/listen`,{method:'POST'});
        if(!response.ok){ const e=await response.json().catch(()=>({error:`Listen fail: ${response.status}`})); throw new Error(e.error); }
        const data=await response.json();
        const transcript = data.transcript?.trim();
        if(transcript){
            console.log("Transcript:", transcript);
            queryInput.value = transcript; // <<< Set input value FIRST
            autoResizeTextarea.call(queryInput); // Resize input
            if(autoSendVoiceInput){
                console.log("Auto-sending voice query...");
                // Don't call handleSendQuery directly as it clears input too early
                // Call the core processing function instead, passing the transcript
                addMessageToHistory('user', transcript); // Add user msg to history
                renderMessage('user', transcript);      // Display user msg visually
                queryInput.value = '';                 // Clear input NOW, after display
                autoResizeTextarea.call(queryInput);   // Resize empty input
                processQueryOrCommand(transcript, false); // Process the transcript query
            } else {
                console.log("Auto-send off. Transcript in input.");
                queryInput.focus(); // Focus input for manual send
            }
        } else { showStatus("No speech detected.", 2000); }
    } catch(error){ handleFetchError(error, "speech recognition");
    } finally { isListening=false; micButton.classList.remove('listening'); micButton.disabled=false; disableOtherInputs(false); statusIndicator.classList.remove('show'); }
}


// --- Webcam ---
function handleWebcamToggle(){if(isGenerating||isListening||awaitingAppPathFor||!backendConnected)return; if(isWebcamActive)captureAndSendImage(); else startWebcam();}
async function startWebcam(){if(isWebcamActive)return; webcamButton.disabled=true; showStatus("Starting webcam..."); try{currentWebcamStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false}); videoElement.srcObject=currentWebcamStream; await videoElement.play(); isWebcamActive=true; webcamButton.classList.add('active'); webcamButton.title='Capture'; showStatus('Webcam active. Click 📸 again.', 4000);}catch(err){handleFetchError(err,"starting webcam");stopWebcam(false);} finally{webcamButton.disabled=false;}}
function stopWebcam(reset=true){if(currentWebcamStream)currentWebcamStream.getTracks().forEach(t=>t.stop()); videoElement.srcObject=null; isWebcamActive=false; currentWebcamStream=null; if(reset){webcamButton.classList.remove('active');webcamButton.title='Analyze Image';} statusIndicator.classList.remove('show');}
function captureAndSendImage(){if(!isWebcamActive||videoElement.readyState<videoElement.HAVE_METADATA)return; showStatus("Capturing..."); canvasElement.width=videoElement.videoWidth;canvasElement.height=videoElement.videoHeight; const ctx=canvasElement.getContext('2d');ctx.drawImage(videoElement,0,0,canvasElement.width,canvasElement.height); const imgData=canvasElement.toDataURL('image/jpeg',0.9); const q=queryInput.value.trim()||"Analyze this image"; stopWebcam(); sendImageAnalysisQuery(q,imgData);}

// --- Utility Disable Inputs ---
function disableOtherInputs(disabled) { queryInput.disabled=disabled; sendButton.disabled=disabled; micButton.disabled=disabled; webcamButton.disabled=disabled; clipboardButton.disabled=disabled;} // Ensure all relevant buttons covered