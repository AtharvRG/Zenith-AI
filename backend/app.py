import os
import io
import json
import logging
import base64
import sys
import webbrowser
import subprocess
import re
import datetime
import urllib.parse

# Gemini and Flask
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold, GenerateContentResponse
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

# Environment, Media, Audio
from dotenv import load_dotenv
from PIL import Image, UnidentifiedImageError
import sounddevice as sd
import vosk
import numpy as np

# --- Configuration ---
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

API_KEY = os.getenv("GEMINI_API_KEY")
VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), "vosk_model", "model")
SYSTEM_PROMPT = "You are Zenith, a helpful and friendly desktop AI assistant. Respond concisely and helpfully to the user's query based on the provided conversation history. Do not attempt to open applications, websites, take notes, or access the clipboard yourself; prefix commands like 'open', 'note:', 'remember:', 'search' are handled by the underlying system, just process the user's text request."

# --- File Paths & Data Storage ---
BASE_DIR = os.path.dirname(__file__)
KNOWN_APPS_FILE = os.path.join(BASE_DIR, "known_apps.json")
KNOWN_WEBSITES_FILE = os.path.join(BASE_DIR, "known_websites.json")
NOTES_FILE = os.path.join(BASE_DIR, "notes.txt")
known_apps = {}
known_websites = {}

# --- Site Search Templates ---
SITE_SEARCH_TEMPLATES = {
    "youtube": "https://www.youtube.com/results?search_query={query}",
    "google": "https://www.google.com/search?q={query}",
    "bing": "https://www.bing.com/search?q={query}",
    "duckduckgo": "https://duckduckgo.com/?q={query}",
    "amazon": "https://www.amazon.com/s?k={query}",
    "wikipedia": "https://en.wikipedia.org/w/index.php?search={query}",
    "github": "https://github.com/search?q={query}",
    "stack overflow": "https://stackoverflow.com/search?q={query}"
}

# --- Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s-%(levelname)s-%(message)s')
logger = logging.getLogger(__name__)

# --- Essential Pre-checks ---
if not API_KEY:
    logger.critical("CRITICAL: GEMINI_API_KEY not found in .env file.")
    sys.exit("Exiting: API Key missing.")
if not os.path.exists(VOSK_MODEL_PATH):
    logger.error(f"CRITICAL: Vosk model not found at expected path: {VOSK_MODEL_PATH}")
    # Allow startup but log the error prominently
    # sys.exit("Exiting: Vosk model missing.")

# --- Load/Save Utilities ---
def load_json_data(filepath, default={}):
    """Loads data from a JSON file, ensuring lowercase keys."""
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return {str(k).lower(): v for k, v in data.items()} # Ensure key is string
        else:
            logger.info(f"{os.path.basename(filepath)} not found. Creating.")
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(default, f)
            return default
    except json.JSONDecodeError as e:
        logger.error(f"JSON Decode Error loading {os.path.basename(filepath)}: {e}", exc_info=True)
        return default
    except Exception as e:
        logger.error(f"Error loading {os.path.basename(filepath)}: {e}", exc_info=True)
        return default

def save_json_data(filepath, data):
    """Saves data to a JSON file with lowercase keys."""
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump({str(k).lower(): v for k, v in data.items()}, f, indent=4)
        logger.info(f"Saved data to {os.path.basename(filepath)}.")
    except Exception as e:
        logger.error(f"Error saving {os.path.basename(filepath)}: {e}", exc_info=True)

# --- Note Taking Utility ---
def add_note(note_text):
    """Appends a timestamped note to the notes file."""
    try:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # Use 'a' mode which creates the file if it doesn't exist
        with open(NOTES_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp}] {note_text.strip()}\n")
        logger.info(f"Note added: {note_text[:50]}...")
        return True
    except IOError as e:
        logger.error(f"IOError writing to notes file '{NOTES_FILE}': {e}", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"Unexpected error writing notes: {e}", exc_info=True)
        return False

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app, origins=["null", "file://"], supports_credentials=True)
logger.info("Flask app initialized with CORS.")

# --- Gemini AI Setup ---
gemini_model = None
try:
    genai.configure(api_key=API_KEY)
    gemini_model = genai.GenerativeModel(
        'gemini-2.0-flash',
        safety_settings={ # Example safety settings
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        }
    )
    logger.info("Gemini model 'gemini-2.0-flash' initialized successfully.")
except Exception as e:
    logger.error(f"Fatal error initializing Gemini: {e}", exc_info=True)
    # Application might not function correctly without the model. Consider how to handle this.

# --- Vosk STT Setup ---
vosk_model = None
samplerate = None
try:
    if os.path.exists(VOSK_MODEL_PATH):
        vosk_model = vosk.Model(VOSK_MODEL_PATH)
        samplerate = 16000 # Default
        try:
            device_info = sd.query_devices(kind='input')
            # Ensure device_info is a dict and has the key
            if isinstance(device_info, dict) and 'default_samplerate' in device_info:
                samplerate = int(device_info['default_samplerate'])
            else:
                logger.warning(f"Could not get default samplerate from device info: {device_info}. Using {samplerate} Hz.")
        except Exception as sd_err:
            logger.warning(f"Sounddevice query failed: {sd_err}. Using {samplerate} Hz.")
        logger.info(f"Vosk model loaded. Samplerate: {samplerate} Hz")
    else:
        logger.warning("Vosk model file path does not exist. Voice input disabled.")
except Exception as e:
    logger.error(f"Error initializing Vosk: {e}", exc_info=True)
    vosk_model = None # Ensure it's None if init fails


# --- Helper Functions ---
def make_error_response(message, status_code, details=None):
    response_data = {"error": message}
    if details:
        response_data["details"] = str(details)
    return jsonify(response_data), status_code

def is_likely_url(text):
    text_lower = text.lower()
    # More robust check for domain.tld patterns + standard http/https/www
    if text_lower.startswith(("http://", "https://", "www.")):
        return True
    # Check for pattern like domain.tld or subdomain.domain.tld
    if re.search(r'^([\w-]+\.)+[\w]{2,}(\b|/|$)', text_lower):
        return True
    return False

def format_history_for_gemini(chat_history):
    """Formats the last N messages for Gemini context, handling roles."""
    history_context = []
    # Consider last CONTEXT_MESSAGE_COUNT messages (defined earlier)
    recent_messages = chat_history[-(2 * 4):] # Example: Last 4 turns (8 messages)
    for msg in recent_messages:
        role = "user" if msg.get('sender') == 'user' else "model"
        content = msg.get('content', '')
        # Ensure content is not empty and is a string before adding
        if isinstance(content, str) and content.strip():
             # Simple text content expected by Gemini API history
             history_context.append({'role': role, 'parts': [{'text': content}]})
        # elif isinstance(content, list): # Future: Handle potential complex content types if needed
        #      history_context.append({'role': role, 'parts': content}) # Assuming content is already formatted parts list
    return history_context


# --- Internal Command Handling Logic ---
def handle_internal_command(query):
    """Checks if the query matches an internal command and executes it.
       Returns a Flask JSON response if handled, otherwise None.
    """
    query_lower = query.lower()
    target = "" # Define target here for wider scope

    # 1. Note/Remember Command
    if query_lower.startswith(("note:", "remember:")):
        prefix_len = 5 if query_lower.startswith("note:") else 9
        note_content = query[prefix_len:].strip()
        if not note_content: return make_error_response("Note cannot be empty.", 400)
        logger.info(f"CMD: 'note' content processing.")
        if add_note(note_content): return jsonify({"status": "handled", "response": "Okay, I've noted that down."})
        else: return make_error_response("Failed to save note. Please check file permissions.", 500)

    # 2. Open/Search Commands (requires more complex logic)
    elif query_lower.startswith(("open ", "search ", "google ", "find ")):
        # Extract potential target/search query after the command word
        try:
            first_space_index = query.find(" ")
            if first_space_index == -1: # Should not happen if starts with "cmd " but check anyway
                return make_error_response("Invalid command format.", 400)
            target = query[first_space_index + 1:].strip()
            if not target: return make_error_response("Please specify what to open or search for.", 400)
        except Exception:
            return make_error_response("Error parsing command.", 400)

        target_lower = target.lower()
        logger.info(f"CMD: '{query_lower.split()[0]}' target: '{target}'")

        # A. Check for Specific Site Search Patterns (e.g., "search youtube cats")
        for site_key, url_template in SITE_SEARCH_TEMPLATES.items():
            patterns_to_check = [
                f"open {site_key} ",
                f"search {site_key} for ",
                f"search {site_key} "
            ]
            if site_key == "google": # Allow just "google cats"
                 patterns_to_check.append("google ")

            for pattern in patterns_to_check:
                 if query_lower.startswith(pattern):
                    search_query = query[len(pattern):].strip()
                    if search_query:
                        logger.info(f"-> Site Search Pattern Matched: Site='{site_key}', Query='{search_query}'")
                        try:
                            encoded_query = urllib.parse.quote_plus(search_query)
                            search_url = url_template.format(query=encoded_query)
                            webbrowser.open(search_url, new=2)
                            return jsonify({"status": "handled", "response": f"Searching {site_key} for '{search_query}'..."})
                        except Exception as e:
                            logger.error(f"Error performing site search on {site_key}: {e}", exc_info=True)
                            return make_error_response(f"Error searching {site_key}", 500)
                    else:
                        # Allow opening base site, e.g. "open youtube"
                         if query_lower == f"open {site_key}" and site_key in known_websites:
                              try:
                                   logger.info(f"-> Opening Known Site Base: '{site_key}'")
                                   webbrowser.open(known_websites[site_key], new=2)
                                   return jsonify({"status":"handled", "response": f"Opening {site_key}."})
                              except Exception as e:
                                   logger.error(f"Error opening known site {site_key}: {e}", exc_info=True)
                                   return make_error_response("Error opening known website", 500)


        # B. Handle General 'open' Commands (Apps, Sites, URLs) if not a site search
        if query_lower.startswith("open "):
            logger.info(f"-> Processing as general 'open' command...")
            # Known Apps
            if target_lower in known_apps:
                app_path = known_apps[target_lower]
                logger.info(f"   Attempting known app: '{target_lower}' at '{app_path}'")
                try:
                    subprocess.Popen([app_path]) # Non-blocking
                    return jsonify({"status": "handled", "response": f"Launching {target}."})
                except FileNotFoundError:
                    logger.error(f"   App path not found: {app_path}. Removing entry.")
                    if target_lower in known_apps: del known_apps[target_lower]
                    save_json_data(KNOWN_APPS_FILE, known_apps)
                    return jsonify({"status": "app_not_found", "app_name": target, "error_hint": "The saved path seems incorrect. Please provide it again."})
                except PermissionError as e:
                    logger.error(f"   Permission denied launching {app_path}: {e}")
                    return make_error_response(f"Permission denied to launch {target}.", 403)
                except Exception as e:
                    logger.error(f"   Failed to launch app {app_path}: {e}", exc_info=True)
                    return make_error_response(f"Sorry, couldn't launch {target}.", 500)
            # Known Websites (Directly)
            elif target_lower in known_websites:
                logger.info(f"   Opening known website: '{target_lower}'")
                try:
                    webbrowser.open(known_websites[target_lower], new=2)
                    return jsonify({"status": "handled", "response": f"Opening {target}."})
                except Exception as e:
                    logger.error(f"   Error opening known website {target_lower}: {e}", exc_info=True)
                    return make_error_response("Error opening website", 500)
            # General URL
            elif is_likely_url(target):
                logger.info(f"   Opening general URL: '{target}'")
                try:
                    url = target if target_lower.startswith("http") else "https://" + target
                    webbrowser.open(url, new=2)
                    return jsonify({"status": "handled", "response": f"Opening {target}."})
                except Exception as e:
                    logger.error(f"   Error opening general URL {target}: {e}", exc_info=True)
                    return make_error_response("Error opening URL", 500)
            # Unknown App
            else:
                logger.info(f"   App not found: '{target}'. Requesting path.")
                return jsonify({"status": "app_not_found", "app_name": target})

        # C. Handle generic web search ("search ...", "google ...") if no specific actions matched
        elif query_lower.startswith(("search ", "google ", "find ", "look up ")):
             # We already assigned `target` earlier if command word was found
             logger.info(f"CMD: Generic web search for: '{target}'")
             try:
                 encoded_query = urllib.parse.quote_plus(target)
                 search_url = SITE_SEARCH_TEMPLATES["google"].format(query=encoded_query) # Default to google
                 webbrowser.open(search_url, new=2)
                 return jsonify({"status": "handled", "response": f"Searching the web for '{target}'..."})
             except Exception as e:
                 logger.error(f"Error performing generic web search: {e}", exc_info=True)
                 return make_error_response("Error performing web search", 500)


    # If query didn't match any known command structure
    return None


# --- API Endpoints ---
@app.route('/')
def index():
    return "Zenith Assistant Backend v1.5"

@app.route('/ping')
def ping():
    # Basic check to see if the server is responsive
    return jsonify({"status": "ok"})

@app.route('/ask_stream', methods=['POST'])
def ask_stream():
    data = request.get_json()
    query = data.get('query', '').strip()
    chat_history = data.get('history', []) # Get history from frontend request

    if not query:
        return make_error_response("Empty query received.", 400)

    logger.info(f"/ask_stream Query: '{query[:100]}...' (History: {len(chat_history)} items)")

    # Attempt to handle command internally first
    internal_response = handle_internal_command(query)
    if internal_response:
        logger.info("Request handled internally.")
        return internal_response # Return JSON response

    # --- If not handled internally, proceed with Gemini ---
    logger.info("Forwarding query to Gemini API.")
    if not gemini_model:
        logger.error("Gemini model not initialized, cannot process query.")
        return make_error_response("AI model unavailable", 503) # 503 Service Unavailable

    gemini_history = format_history_for_gemini(chat_history)

    def generate_chunks():
        """Generator function for streaming Gemini responses."""
        try:
            # Start a chat session with history
            chat_session = gemini_model.start_chat(history=gemini_history)
            # Send the user's query
            stream = chat_session.send_message(query, stream=True)

            for chunk in stream:
                # Handle potential errors or blocked content within the stream
                # Note: Check for block reason *before* accessing text if possible API change
                # As of early 2024, text is usually available even if blocked, check prompt_feedback
                if chunk.prompt_feedback and chunk.prompt_feedback.block_reason:
                    reason = chunk.prompt_feedback.block_reason.name
                    logger.warning(f"Gemini content generation blocked. Reason: {reason}")
                    yield f"ERROR: Content blocked by safety filter ({reason})\n"
                    return # Stop generation if blocked

                if chunk.text:
                    yield chunk.text + "\n" # Send text chunk, newline delimited

        except Exception as e:
            logger.error(f"Error during Gemini streaming generation: {e}", exc_info=True)
            yield f"ERROR: An error occurred while contacting the AI: {str(e)}\n"

    # Return the streaming response
    return Response(stream_with_context(generate_chunks()), mimetype='text/plain; charset=utf-8')


@app.route('/add_app', methods=['POST'])
def add_app():
    """Adds or updates an application path in known_apps.json."""
    global known_apps
    data = request.get_json()
    if not data or 'app_name' not in data or 'app_path' not in data:
        return make_error_response("Missing 'app_name' or 'app_path' in request", 400)

    app_name = data['app_name'].strip()
    app_path = data['app_path'].strip().replace('"', '') # Remove quotes just in case
    app_name_lower = app_name.lower()

    logger.info(f"Request to add/update app: '{app_name}' with path: '{app_path}'")

    # Basic Path Validation
    if not app_path:
        return make_error_response("Application path cannot be empty", 400)
    if not os.path.exists(app_path):
        logger.warning(f"Validation failed: Provided path does not exist: {app_path}")
        return make_error_response(f"Path not found: '{app_path}'. Please provide the full, correct path.", 400)
    if not os.path.isfile(app_path):
        logger.warning(f"Validation failed: Provided path is not a file: {app_path}")
        return make_error_response(f"Path is not a file: '{app_path}'. It should point to the executable.", 400)
    # OS specific check (optional but recommended)
    if sys.platform == "win32" and not app_path.lower().endswith(('.exe', '.bat', '.lnk', '.cmd')):
        logger.warning(f"Path '{app_path}' might not be directly executable on Windows.")

    try:
        known_apps[app_name_lower] = app_path
        save_json_data(KNOWN_APPS_FILE, known_apps) # Use the save utility
        logger.info(f"Application '{app_name}' path saved successfully.")
        return jsonify({"status": "success", "response": f"Okay, I've learned the path for '{app_name}'. You can now ask me to open it."})
    except Exception as e:
        logger.error(f"Failed to save application '{app_name}': {e}", exc_info=True)
        return make_error_response("Internal error saving the application path.", 500, details=e)


@app.route('/process_clipboard', methods=['POST'])
def process_clipboard():
    """Receives clipboard text and history, sends to Gemini for analysis."""
    data = request.get_json()
    clipboard_text = data.get('text', '').strip()
    chat_history = data.get('history', [])
    if not clipboard_text: return make_error_response("Clipboard text is empty.", 400)
    if not gemini_model: return make_error_response("AI model unavailable", 503)

    logger.info(f"Processing clipboard text (length: {len(clipboard_text)})...")
    clipboard_query = f"Analyze the following text from the clipboard:\n\n'''\n{clipboard_text}\n'''\n\nWhat is this about? Summarize it or explain any key points."
    gemini_history = format_history_for_gemini(chat_history)

    def generate_chunks():
        """Streams Gemini response for clipboard analysis."""
        try:
            chat_session = gemini_model.start_chat(history=gemini_history)
            stream = chat_session.send_message(clipboard_query, stream=True)
            for chunk in stream:
                if chunk.prompt_feedback and chunk.prompt_feedback.block_reason:
                    reason = chunk.prompt_feedback.block_reason.name; yield f"ERROR: Blocked({reason})\n"; return
                if chunk.text: yield chunk.text + "\n"
        except Exception as e: logger.error(f"Clipboard processing error: {e}"); yield f"ERROR: AI processing error\n"

    return Response(stream_with_context(generate_chunks()), mimetype='text/plain; charset=utf-8')


@app.route('/analyze_image', methods=['POST'])
def analyze_image():
    """Analyzes an image with an optional query, no history context for simplicity."""
    if not gemini_model: return make_error_response("AI model unavailable", 503)
    data = request.get_json(); query = data.get('query', "Describe this image."); image_data_uri = data.get('image_data');
    if not image_data_uri: return make_error_response("No image data provided", 400)
    logger.info(f"Image analysis request. Query: {query[:50]}...")
    try:
        header, encoded = image_data_uri.split(",", 1); image_data = base64.b64decode(encoded); image = Image.open(io.BytesIO(image_data))
        # Keep image prompt simple - text query + image. History is complex with images.
        prompt_parts = [ f"{SYSTEM_PROMPT}\n\nUser: {query}", image ]
        # Use generate_content directly for image analysis
        response = gemini_model.generate_content(prompt_parts)
        if response.prompt_feedback and response.prompt_feedback.block_reason:
            reason = response.prompt_feedback.block_reason.name; logger.warning(f"Image analysis blocked: {reason}")
            return make_error_response("Content blocked by safety filter", 400, details=reason)
        # Resolve the response before returning JSON
        response.resolve() # Ensure generation is complete
        return jsonify({"response": response.text})
    except UnidentifiedImageError:
        logger.error("Cannot identify image format from provided data.")
        return make_error_response("Invalid image format", 400)
    except (ValueError, TypeError, base64.binascii.Error) as decode_err:
         logger.error(f"Image data decoding error: {decode_err}", exc_info=True)
         return make_error_response("Invalid image data format", 400)
    except Exception as e:
        logger.error(f"Error during image analysis: {e}", exc_info=True)
        return make_error_response("An error occurred during image analysis", 500)


@app.route('/listen', methods=['POST'])
def listen_for_speech():
    """Listens for speech using Vosk and returns the transcript."""
    if not vosk_model or not samplerate:
        logger.error("Voice recognition components not ready.")
        return make_error_response("Voice recognition components unavailable", 503)

    listen_duration = 5 # seconds
    logger.info(f"Listening for speech ({listen_duration}s) at {samplerate} Hz...")
    recognizer = vosk.KaldiRecognizer(vosk_model, samplerate)
    recognizer.SetWords(False) # We don't need word timestamps usually
    transcript = ""
    audio_data = []

    try:
        def audio_callback(indata, frames, time, status):
            """This callback gets called by sounddevice for each audio buffer."""
            if status:
                logger.warning(f"Sounddevice status: {status}")
            # Append audio data (ensure it's bytes)
            audio_data.append(bytes(indata))

        # Use InputStream context manager for clean resource handling
        with sd.InputStream(callback=audio_callback, samplerate=samplerate, channels=1, dtype='int16', blocksize=8000):
            sd.sleep(listen_duration * 1000) # Record for the specified duration

        logger.info(f"Recording finished. Processing {len(audio_data)} audio chunks.")
        if not audio_data:
             logger.warning("No audio data was captured during listening period.")
             return jsonify({"transcript": ""}) # Return empty if nothing recorded

        # Process the entire recorded audio at once
        full_audio = b"".join(audio_data)
        if recognizer.AcceptWaveform(full_audio):
            result = json.loads(recognizer.Result())
            transcript = result.get('text', '')
        else:
            # Get final result even if AcceptWaveform returned false (common for short utterances)
            final_result = json.loads(recognizer.FinalResult())
            transcript = final_result.get('text', '')

        logger.info(f"Transcription complete: '{transcript}'")
        return jsonify({"transcript": transcript})

    except sd.PortAudioError as pa_err:
        err_msg = "Microphone not found or PortAudio error." if "Invalid device" in str(pa_err) or "No Default Input Device" in str(pa_err) else "Audio device error during recording."
        logger.error(f"PortAudioError: {pa_err}", exc_info=True)
        return make_error_response(err_msg, 500, details=str(pa_err))
    except Exception as e:
        logger.error(f"Unexpected error during speech recognition: {e}", exc_info=True)
        return make_error_response("Speech recognition failed due to an internal error.", 500, details=str(e))


# --- Main Execution ---
if __name__ == '__main__':
    print("--- Initializing Zenith Backend v1.5 ---")
    # Load data on startup
    known_apps = load_json_data(KNOWN_APPS_FILE, {})
    known_websites = load_json_data(KNOWN_WEBSITES_FILE, {})
    # Ensure notes file exists
    if not os.path.exists(NOTES_FILE):
        try: open(NOTES_FILE, 'a', encoding='utf-8').close(); logger.info("Created empty notes file.")
        except Exception as e: logger.error(f"Failed to create notes file on startup: {e}")

    logger.info("--- Starting Flask Server ---")
    # Use 127.0.0.1 for local access only; debug=False for stability
    app.run(host='127.0.0.1', port=5111, debug=False)