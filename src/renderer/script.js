/**
 * Zenith Assistant - Renderer Process Script (script.js) V1.2.1
 * Handles UI, backend communication, chat history, commands (open), voice, webcam.
 * Includes console logs for clearChat debugging.
 */

// --- DOM Elements ---
const queryInput = document.getElementById('query-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const webcamButton = document.getElementById('webcam-button');
const chatContainer = document.getElementById('chat-container');
const statusIndicator = document.getElementById('status-indicator');
const minimizeBtn = document.getElementById('minimize-btn');
const maximizeBtn = document.getElementById('maximize-btn');
const closeBtn = document.getElementById('close-btn');
const clearChatBtn = document.getElementById('clear-chat-btn'); // Ensure this selection happens
const stopButton = document.getElementById('stop-button');
const videoElement = document.getElementById('webcam-video');
const canvasElement = document.getElementById('webcam-canvas');
const interactionArea = document.querySelector('.interaction-area');

// --- Constants ---
const PYTHON_BACKEND_URL = 'http://127.0.0.1:5111';
const CHAT_HISTORY_KEY = 'zenithAssistantChatHistory';

// --- State Variables ---
let isListening = false;                // Microphone active?
let isGenerating = false;               // AI processing/responding?
let isWebcamActive = false;             // Webcam stream active?
let currentWebcamStream = null;         // MediaStream object for webcam
let currentAssistantMessageElement = null; // DOM element being streamed into
let chatHistory = [];                   // Array of message objects
let abortController = null;             // For aborting fetch requests
let awaitingAppPathFor = null;          // Holds name of app needing path input

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing script..."); // DEBUG
    setupEventListeners();
    loadChatHistory();
    renderChatHistory();
    autoResizeTextarea.call(queryInput);

    // Configure Marked library for Markdown rendering
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true, // Convert single line breaks to <br>
            gfm: true,    // Use GitHub Flavored Markdown
        });
    } else {
        console.error("Marked library not loaded. Markdown rendering will be disabled.");
    }
    console.log("Initialization complete."); // DEBUG
});

// Handle window ready signal from main process for entry animation
window.electronAPI.onWindowReady(() => {
    console.log("Window Ready signal received."); // DEBUG
    document.body.classList.add('loaded');
    // Focus input slightly after animation starts
    setTimeout(() => queryInput.focus(), 100);
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    console.log("Setting up event listeners..."); // DEBUG
    // Window Controls
    // Use optional chaining ?. in case elements aren't found immediately
    minimizeBtn?.addEventListener('click', () => window.electronAPI.minimizeApp());
    maximizeBtn?.addEventListener('click', () => window.electronAPI.maximizeApp());
    closeBtn?.addEventListener('click', () => window.electronAPI.closeApp());

    // **DEBUGGING CLEAR CHAT BUTTON**
    console.log("Attempting to select clear chat button with ID 'clear-chat-btn':", document.getElementById('clear-chat-btn')); // DEBUG Check selection
    if (clearChatBtn) { // Check if the element was found before adding listener
        clearChatBtn.addEventListener('click', clearChat);
        console.log("Event listener ADDED for clearChatBtn."); // DEBUG Confirm listener added
    } else {
        console.error("CRITICAL: Could not find clear chat button (ID: clear-chat-btn) in the DOM!"); // DEBUG Error if not found
    }

    // Input & Actions
    queryInput?.addEventListener('input', autoResizeTextarea); // Auto-resize on type
    queryInput?.addEventListener('keypress', handleInputKeypress); // Handle Enter key
    sendButton?.addEventListener('click', handleSendQuery); // Send button click
    micButton?.addEventListener('click', handleMicToggle); // Mic button click
    webcamButton?.addEventListener('click', handleWebcamToggle); // Webcam button click
    stopButton?.addEventListener('click', handleStopGeneration); // Stop generation button click
    console.log("Event listeners setup finished."); // DEBUG
}

// --- Core UI Functions ---
function autoResizeTextarea() {
    this.style.height = 'auto'; // Temporarily shrink to get correct scrollHeight
    const maxHeight = 120; // Max height in pixels (matches CSS)
    // Set height, but clamp it to maxHeight
    this.style.height = Math.min(this.scrollHeight, maxHeight) + 'px';
    // Check if user is near the bottom, if so, scroll chat down
    const isScrolledNearBottom = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 50;
    if (isScrolledNearBottom) {
        scrollToBottom();
    }
}
function handleInputKeypress(event) {
    // Send query if Enter is pressed WITHOUT the Shift key
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // Prevent default newline insertion
        handleSendQuery();
    }
}
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
function showStatus(message, duration = 3000) {
    statusIndicator.textContent = message;
    statusIndicator.classList.add('show');
    // Clear any existing timeout to prevent overlapping messages
    clearTimeout(statusIndicator.timer);
    // Set a new timeout to hide the message
    statusIndicator.timer = setTimeout(() => {
        statusIndicator.classList.remove('show');
    }, duration);
}

// Update UI element states based on processing or waiting for input
function setGeneratingState(generating, isAwaitingInput = false) {
    const trulyGenerating = generating && !isAwaitingInput;
    isGenerating = trulyGenerating; // Update global state
    stopButton.classList.toggle('hidden', !trulyGenerating); // Show stop only if generating

    const disableAllInputs = generating || isAwaitingInput;
    queryInput.disabled = disableAllInputs;
    sendButton.disabled = disableAllInputs;
    micButton.disabled = disableAllInputs;
    webcamButton.disabled = disableAllInputs;

    interactionArea.classList.toggle('generating', trulyGenerating); // CSS cue for generating
    interactionArea.classList.toggle('awaiting-input', isAwaitingInput); // CSS cue for awaiting path

    // Restore placeholder only when exiting awaiting state
    if (!isAwaitingInput) {
        queryInput.placeholder = "Ask Zenith anything...";
    }
}

// --- Chat History Management ---
function loadChatHistory() {
    const savedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
    if (savedHistory) {
        try {
            chatHistory = JSON.parse(savedHistory);
            console.log(`Loaded ${chatHistory.length} messages from history (Key: ${CHAT_HISTORY_KEY}).`);
        } catch (e) {
            console.error("Failed to parse chat history from localStorage:", e);
            chatHistory = []; // Reset if data is corrupted
            localStorage.removeItem(CHAT_HISTORY_KEY); // Clear corrupted data
        }
    } else {
        chatHistory = []; // Start fresh if no history found
    }
    // Add initial Zenith greeting message if the history is empty
     if (chatHistory.length === 0) {
        // Use the new Zenith branding in the greeting
        chatHistory.push({ sender: 'assistant', content: 'Hello! I am Zenith ✨. How can I assist you today?', type: 'text'});
        saveChatHistory(); // Save the initial greeting
     }
}
function saveChatHistory() {
    try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory));
    } catch (e) {
        console.error("Failed to save chat history to localStorage:", e);
         showStatus("Error saving chat history.", 4000);
    }
}
function addMessageToHistory(sender, content, type = 'text', imageUrl = null) {
    const message = { sender, content, type };
    // Include image URL if it's an image message
    if (type === 'image' && imageUrl) {
        message.imageUrl = imageUrl; // Store data URI or actual URL
    }
    chatHistory.push(message);
    saveChatHistory(); // Persist after every addition
    return message; // Return the added message object
}
function renderChatHistory() {
    chatContainer.innerHTML = ''; // Clear existing messages
    chatHistory.forEach(msg => {
        renderMessage(msg.sender, msg.content, msg.imageUrl, msg.type === 'error', false, msg.type);
    });
    scrollToBottom();
}

// --- Clear Chat Function (with Debugging) ---
function clearChat() {
    console.log("clearChat function called."); // DEBUG
    chatHistory = []; // Clear in-memory array
    console.log("In-memory chatHistory array cleared."); // DEBUG

    // Add the branded greeting back after clearing
    // Note: addMessageToHistory also calls saveChatHistory implicitly
    addMessageToHistory('assistant', 'Chat cleared. I am Zenith ✨, ready for your next question!', 'text');
    console.log("Cleared greeting added to history (and saved)."); // DEBUG

    renderChatHistory(); // Re-render the chat (now just shows the greeting)
    console.log("Chat re-rendered from history."); // DEBUG

    queryInput.value = ''; // Clear input field
    autoResizeTextarea.call(queryInput); // Reset input height
    showStatus("Chat cleared", 2000); // User feedback

    // Ensure awaiting state is cleared if chat is cleared while waiting
    if (awaitingAppPathFor) {
        console.log("Clearing 'awaitingAppPathFor' state."); // DEBUG
        awaitingAppPathFor = null;
        setGeneratingState(false, false); // Exit awaiting state fully
    }
    console.log("clearChat function finished."); // DEBUG
}


// --- Message Rendering ---
function renderMessage(sender, content, imageUrl = null, isError = false, isThinking = false, type = 'text') {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender); // Apply 'user' or 'assistant' class

    // Add special classes based on message state/type
    if (isError || type === 'error') messageElement.classList.add('error');
    if (isThinking) messageElement.classList.add('thinking');

    const span = document.createElement('span'); // Element to hold text content

    // Render content: Use Marked for Markdown, otherwise plain text
    if (!isError && !isThinking && type === 'text' && typeof marked !== 'undefined') {
        try {
            span.innerHTML = marked.parse(content); // Parse and render Markdown
        } catch (e) {
             console.error("Markdown parsing error:", e);
             span.textContent = content; // Fallback to plain text on error
        }
    } else {
        span.textContent = content; // Use plain text for errors, thinking states, or if Marked fails
    }
    messageElement.appendChild(span);

    // If an image URL is provided, create and append an image element
    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = sender === 'user' ? "User Upload" : "Image provided by Zenith"; // Accessible alt text
        messageElement.appendChild(img);
    }

    chatContainer.appendChild(messageElement); // Add the new message to the chat
    scrollToBottom(); // Ensure the latest message is visible
    return messageElement; // Return the created element for potential updates (streaming)
}


// --- Unified Send Button Handler ---
function handleSendQuery() {
    const userInput = queryInput.value.trim();
    if (!userInput) return; // Do nothing if input is empty

    const currentAwaitingApp = awaitingAppPathFor; // Check if waiting BEFORE clearing input

    queryInput.value = '';
    autoResizeTextarea.call(queryInput);
    queryInput.focus();

    // --- Case 1: User is providing an application path ---
    if (currentAwaitingApp) {
        console.log(`Path provided for '${currentAwaitingApp}': ${userInput}`);
        // Display user input (as path)
        renderMessage('user', `Path for ${currentAwaitingApp}: ${userInput}`, null, false, false, 'text');
        addMessageToHistory('user', `Provided path for ${currentAwaitingApp}: ${userInput}`, 'text');
        // Send path to backend
        sendAppPathToBackend(currentAwaitingApp, userInput);
        // Reset state: no longer awaiting path
        awaitingAppPathFor = null;
        // Placeholder reset happens in setGeneratingState
        setGeneratingState(false, false); // Exit awaiting state fully

    }
    // --- Case 2: User is sending a normal query or command ---
    else if (!isGenerating && !isListening) { // Prevent sending while busy
        addMessageToHistory('user', userInput, 'text');
        renderMessage('user', userInput, null, false, false, 'text');
        processPotentialCommandOrQuery(userInput); // Process it (command or Gemini)
    }
}

// --- Processes Input: Checks for Commands or Sends to Gemini ---
async function processPotentialCommandOrQuery(query) {
    setGeneratingState(true, false); // Enter processing state
    abortController = new AbortController(); // Allow aborting

    // Create assistant placeholder message
    currentAssistantMessageElement = renderMessage('assistant', '', null, false, true, 'text');
    const contentSpan = currentAssistantMessageElement.querySelector('span');
    if (contentSpan) contentSpan.textContent = ''; // Ensure empty

    try {
        // Send to backend; backend decides stream/JSON based on query
        const response = await fetch(`${PYTHON_BACKEND_URL}/ask_stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal: abortController.signal,
        });

        const contentType = response.headers.get("content-type");

        // --- Response Type: JSON (Backend Handled Command/Error) ---
        if (contentType?.includes("application/json")) {
            const data = await response.json();
            console.log("Received JSON response:", data);

            currentAssistantMessageElement?.classList.remove('thinking'); // Stop thinking animation

            if (!response.ok) { throw new Error(data.error || `Request failed: ${response.status}`); }

            // Process backend status
            if (data.status === "handled" || data.status === "success") {
                contentSpan.innerHTML = marked.parse(data.response);
                addMessageToHistory('assistant', data.response, 'text');
            } else if (data.status === "app_not_found") {
                awaitingAppPathFor = data.app_name; // Enter awaiting state
                setGeneratingState(false, true);    // Set UI to awaiting state
                const message = data.error_hint ? `${data.error_hint}\n` : "";
                const promptText = `${message}I don't know the path for **${data.app_name}**. Please enter the full path to its executable (e.g., C:\\Path\\To\\App.exe):`;
                contentSpan.innerHTML = marked.parse(promptText);
                addMessageToHistory('assistant', promptText, 'text'); // Save prompt asking for path
                queryInput.placeholder = `Enter full path for ${data.app_name}...`; // Change placeholder
                scrollToBottom();
                // DO NOT nullify message element - it shows the prompt
                // DO NOT exit generating state here - handled by setGeneratingState(false, true)
                return; // Stop, wait for user to provide path
            } else { // Other JSON errors
                throw new Error(data.response || data.error || "Unknown error from backend");
            }
        }
        // --- Response Type: Text Stream (Gemini Response) ---
        else if (contentType?.includes("text/plain")) {
            console.log("Received Streaming response from backend.");
            currentAssistantMessageElement?.classList.remove('thinking');
            await processStreamResponse(response.body, contentSpan); // Process the stream
        }
        // --- Response Type: Unexpected ---
        else {
            const responseText = await response.text(); // Read as text for debugging
            throw new Error(`Unexpected response type: ${contentType}. Content: ${responseText.substring(0, 100)}...`);
        }

    } catch (error) {
        // Use centralized handler for AbortError, Network errors etc.
        handleFetchError(error, "processing query/command");
    } finally {
        // Reset state ONLY IF we are NOT currently waiting for user path input
        if (!awaitingAppPathFor) {
            setGeneratingState(false, false);
            currentAssistantMessageElement = null;
            abortController = null;
        }
    }
}

// --- Helper to Process Text Stream from Backend ---
async function processStreamResponse(responseBody, contentSpan) {
    let accumulatedResponse = "";
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break; // Exit loop when stream ends

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n'); // Backend sends newline-delimited chunks or errors

            for (const line of lines) {
                 // Check for error prefix sent from backend
                 if (line.startsWith("ERROR:")) {
                    const errorMessage = line.substring(6).trim();
                    console.error("Backend Streaming Error:", errorMessage);
                    // Handle error visually
                    currentAssistantMessageElement?.remove(); // Remove the thinking placeholder
                    renderMessage('assistant', `Stream Error: ${errorMessage}`, null, true, false, 'error');
                    addMessageToHistory('assistant', `Stream Error: ${errorMessage}`, 'error');
                    currentAssistantMessageElement = null; // Clear reference
                    throw new Error(errorMessage); // Propagate to stop processing
                 } else if (line) { // Process valid text chunks (ignore empty lines from split)
                    accumulatedResponse += line; // Append to the full response string
                    // Update the content span with incrementally parsed Markdown
                    // Check contentSpan exists before updating - could be removed by error
                    if (contentSpan) {
                        contentSpan.innerHTML = marked.parse(accumulatedResponse);
                        scrollToBottom(); // Keep chat scrolled down
                    }
                 }
            }
        }
        // After stream finishes successfully, save the complete response to history
        // Check element still exists - it might have been removed by an error during stream
        if (currentAssistantMessageElement) {
             addMessageToHistory('assistant', accumulatedResponse, 'text');
        }

    } catch (streamError) {
        console.error("Error while processing stream:", streamError);
        // If error happened during decoding/reading, show generic message?
        // Check if an error message was already rendered
        if (currentAssistantMessageElement){ // If placeholder still somehow exists
             currentAssistantMessageElement.remove();
             renderMessage('assistant', `Stream processing error: ${streamError.message}`, null, true, false, 'error');
             addMessageToHistory('assistant', `Stream processing error: ${streamError.message}`, 'error');
        }
        // Don't re-throw here, let the outer try/catch handle it via handleFetchError
    }
}


// --- Sends the collected App Path to the Backend ---
async function sendAppPathToBackend(appName, appPath) {
    console.log(`Sending app path: Name=${appName}, Path=${appPath}`);
    setGeneratingState(true, false); // Indicate processing
    let tempMsg = renderMessage('assistant', `Saving path for ${appName}...`, null, false, true, 'text'); // Thinking indicator

    try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/add_app`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_name: appName, app_path: appPath }),
        });

        const data = await response.json(); // Expect JSON response
        tempMsg?.remove(); // Remove thinking indicator

        if (!response.ok) {
            throw new Error(data.error || `Failed to add app: ${response.status}`);
        }

        console.log("App path added via backend:", data.response);
        renderMessage('assistant', data.response); // Show success message
        addMessageToHistory('assistant', data.response, 'text');

    } catch (error) {
        console.error("Error sending app path:", error);
        tempMsg?.remove(); // Remove thinking indicator
        renderMessage('assistant', `Error saving path: ${error.message}`, null, true, false, 'error');
        addMessageToHistory('assistant', `Error saving path: ${error.message}`, 'error');
    } finally {
        setGeneratingState(false, false); // Exit processing state
        // Ensure awaiting state is cleared (should be already, but safe)
        awaitingAppPathFor = null;
    }
}

// --- Centralized Fetch Error Handling ---
function handleFetchError(error, context = "request") {
    // Ignore abort errors as they are user-initiated
    if (error.name === 'AbortError') {
         console.log(`Fetch aborted by user during ${context}.`);
         showStatus('Request stopped.', 2000);
         // Add note to message if it exists and has content
         if (currentAssistantMessageElement) {
             const contentSpan = currentAssistantMessageElement.querySelector('span');
             if (contentSpan && contentSpan.textContent?.trim()) {
                 // Append stop note only if there was some content generated
                 contentSpan.innerHTML += marked.parse("\n\n*(Request stopped)*");
                 // Save the partial response with the stop note to history
                 addMessageToHistory('assistant', contentSpan.textContent, 'text');
             } else {
                 // If the message element exists but has no text content, just remove it
                 currentAssistantMessageElement.remove();
             }
         }
    } else { // Handle other network/backend errors
         console.error(`Error during ${context}:`, error);
         currentAssistantMessageElement?.remove(); // Clean up placeholder if it exists
         // Render a distinct error message in the chat
         renderMessage('assistant', `Error: ${error.message}`, null, true, false, 'error');
         // Add the error message to history
         addMessageToHistory('assistant', `Error: ${error.message}`, 'error');
    }
}


// --- Image Analysis Query ---
async function sendImageAnalysisQuery(query, imageDataURL) {
    if (isGenerating || isListening || awaitingAppPathFor) return; // Prevent if busy/waiting

    addMessageToHistory('user', query, 'image', imageDataURL);
    renderMessage('user', query, imageDataURL, false, false, 'image');

    setGeneratingState(true, false);
    currentAssistantMessageElement = renderMessage('assistant', '', null, false, true, 'text');
    abortController = new AbortController();

    try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/analyze_image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, image_data: imageDataURL }),
            signal: abortController.signal,
        });

        currentAssistantMessageElement?.classList.remove('thinking');
        const data = await response.json(); // Expect JSON response for success/error

        if (!response.ok) {
            throw new Error(data.error || `Image analysis failed: ${response.status}`);
        }

        // Success: update placeholder and save history
        if (currentAssistantMessageElement) {
           currentAssistantMessageElement.querySelector('span').innerHTML = marked.parse(data.response);
        } else { // Fallback if element somehow got removed
           currentAssistantMessageElement = renderMessage('assistant', data.response);
        }
        addMessageToHistory('assistant', data.response, 'text');

    } catch (error) {
        handleFetchError(error, "image analysis"); // Use centralized handler
    } finally {
        // Ensure state is reset ONLY if not awaiting path input
        if (!awaitingAppPathFor) {
             setGeneratingState(false, false);
             currentAssistantMessageElement = null;
             abortController = null;
        }
    }
}


// --- Stop Button Handler ---
function handleStopGeneration() {
     // Only attempt abort if actively generating and controller exists
     if (isGenerating && abortController) {
         console.log("Attempting to stop generation/analysis...");
         abortController.abort(); // Trigger the abort signal
         // State reset is handled in the fetch error/finally blocks
     }
}

// --- Speech Recognition Handler ---
async function handleMicToggle() {
    if (isGenerating || awaitingAppPathFor) return; // Prevent if busy or waiting for path
    if (isListening) {
        // Note: Backend currently listens for a fixed duration. Stopping early isn't implemented.
        console.warn("Mic stop request ignored; backend listens for fixed duration.");
        return;
    }

    // --- Start Listening ---
    isListening = true;
    micButton.classList.add('listening'); micButton.disabled = true;
    disableOtherInputs(true); showStatus("Listening...", 5000); // Show for duration

    try {
        // Request transcription from the backend /listen endpoint
        const response = await fetch(`${PYTHON_BACKEND_URL}/listen`, { method: 'POST' });

        // Check HTTP status BEFORE trying to parse JSON
        if (!response.ok) {
            // Try to get specific error from backend JSON response
            const errorData = await response.json().catch(() => ({ error: `Listen request failed: ${response.status}` }));
            // Provide user-friendly messages for common backend issues
            if (errorData.error?.includes("model unavailable")) throw new Error("Voice model unavailable on backend.");
            else if (errorData.error?.includes("audio error")) throw new Error("Microphone/audio error on backend.");
            // Generic fallback error
            throw new Error(errorData.error || `Listen request failed: ${response.status}`);
        }

        // If response is OK, parse the JSON data
        const data = await response.json();

        // Process the received transcript
        if (data.transcript?.trim()) {
            console.log("Transcript received:", data.transcript);
            queryInput.value = data.transcript; // Populate the input field
            autoResizeTextarea.call(queryInput); // Adjust input height
            handleSendQuery(); // Automatically send the transcript using the main handler
        } else {
            // Handle cases like no speech detected or backend error providing transcript
            console.log("No speech detected or empty transcript returned.");
             showStatus("No speech detected.", 2000); // User feedback
        }

    } catch (error) { // Catch errors from fetch or manual throws
        console.error('Speech Error:', error);
        // Display error in chat and history
        renderMessage('assistant', `Speech Error: ${error.message}`, null, true, false, 'error');
        addMessageToHistory('assistant', `Speech Error: ${error.message}`, 'error');
    } finally {
        // Always reset listening state and UI elements
        isListening = false;
        micButton.classList.remove('listening');
        micButton.disabled = false; // Re-enable mic button
        disableOtherInputs(false); // Re-enable other inputs
        statusIndicator.classList.remove('show'); // Ensure "Listening..." message is hidden
    }
}


// --- Webcam Handlers ---
function handleWebcamToggle() {
    if (isGenerating || isListening || awaitingAppPathFor) return; // Prevent if busy/waiting
    if (isWebcamActive) captureAndSendImage();
    else startWebcam();
}
async function startWebcam() {
    if (isWebcamActive) return; // Already active
    webcamButton.disabled = true; showStatus("Starting webcam...");
    try {
        // Request video stream from user's device
        currentWebcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoElement.srcObject = currentWebcamStream; // Assign stream to hidden video element
        await videoElement.play(); // Wait for the video to start playing
        // Update state and UI
        isWebcamActive = true;
        webcamButton.classList.add('active'); // Visual cue (e.g., turns red)
        webcamButton.title = 'Capture & Analyze'; // Update tooltip
        showStatus('Webcam active. Aim & click 📸 again to capture.', 4000); // Instruct user
    } catch (err) { // Handle errors (e.g., permissions denied, no camera)
        console.error("Webcam Error:", err);
        // Display error in chat and history
        renderMessage('assistant', `Webcam Error: ${err.message}`, null, true);
        addMessageToHistory('assistant', `Webcam Error: ${err.message}`, 'error');
        stopWebcam(false); // Ensure cleanup even on error
    } finally {
        webcamButton.disabled = false; // Re-enable button after attempt
    }
}
function stopWebcam(resetButton = true) {
    // Stop all tracks in the stream
    if (currentWebcamStream) {
        currentWebcamStream.getTracks().forEach(track => track.stop());
    }
    videoElement.srcObject = null; // Remove stream from video element
    isWebcamActive = false; // Update state flag
    currentWebcamStream = null; // Clear stream reference
    // Reset button appearance if requested
    if(resetButton) {
        webcamButton.classList.remove('active');
        webcamButton.title = 'Analyze Image';
    }
    statusIndicator.classList.remove('show'); // Hide any related status message
}
function captureAndSendImage() {
    // Ensure webcam is active and ready
    if (!isWebcamActive || !videoElement.srcObject || videoElement.readyState < videoElement.HAVE_METADATA) {
        console.warn("Webcam not ready for capture.");
        showStatus("Webcam not ready...", 2000);
        return;
    }

    showStatus("Capturing..."); // Feedback during capture process

    // Set canvas dimensions to match the video's natural dimensions
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    // Draw the current video frame onto the hidden canvas
    const context = canvasElement.getContext('2d');
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Convert canvas content to a Base64 JPEG data URL
    const imageDataURL = canvasElement.toDataURL('image/jpeg', 0.90); // Adjust quality (0.0-1.0)

    // Get any accompanying text query from the input field, or use a default
    const userQuery = queryInput.value.trim() || "Analyze this image and solve any questions shown.";

    stopWebcam(); // Stop the webcam stream immediately after capture

    sendImageAnalysisQuery(userQuery, imageDataURL); // Send data to the backend
}

// --- Utility to Disable/Enable Inputs ---
// Helper to disable/enable input elements other than the one actively used
function disableOtherInputs(disabled) {
     queryInput.disabled = disabled;
     sendButton.disabled = disabled;
     // Only disable mic/webcam if not the active initiator OR if inputs are being generally enabled
     if (!isListening) micButton.disabled = disabled;
     // Keep webcam enabled unless generally disabled (allow capture click)
     // Update: Better to disable webcam button too when other actions are happening
     webcamButton.disabled = disabled;

    // Old logic (might allow stopping webcam when active):
    // if (!isWebcamActive || !disabled) webcamButton.disabled = disabled;
}