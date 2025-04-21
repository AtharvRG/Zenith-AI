import os
import io
import json
import logging
import base64
import sys
import webbrowser # For opening web pages
import subprocess # For opening applications
import re         # For URL detection

# Gemini and Flask related imports
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

# Environment and Image/Audio handling
from dotenv import load_dotenv
from PIL import Image, UnidentifiedImageError
import sounddevice as sd
import vosk
import numpy as np

# --- Configuration ---
# Load .env file from the parent directory relative to this script
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

API_KEY = os.getenv("GEMINI_API_KEY")
VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), "vosk_model", "model")
SYSTEM_PROMPT = "You are Zenith, a helpful and friendly desktop AI assistant. Always introduce yourself or refer to yourself as Zenith when appropriate. When asked to 'open' something, the backend will handle apps and websites directly if possible."

# --- Known Apps Configuration ---
KNOWN_APPS_FILE = os.path.join(os.path.dirname(__file__), "known_apps.json")
known_apps = {} # Dictionary to hold loaded app paths {lowercase_name: path}

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- Essential Pre-checks ---
if not API_KEY:
    logger.error("CRITICAL: GEMINI_API_KEY not found in .env file.")
    sys.exit("Exiting: API Key missing.")

if not os.path.exists(VOSK_MODEL_PATH):
     logger.error(f"CRITICAL: Vosk model not found at expected path: {VOSK_MODEL_PATH}")
     logger.error("Please download a Vosk model and place it inside 'backend/vosk_model/model/'.")
     # Log critical warning but allow startup for other features
     # sys.exit("Exiting: Vosk model missing.")

# --- Known Apps Management ---
def load_known_apps():
    global known_apps
    try:
        if os.path.exists(KNOWN_APPS_FILE):
            with open(KNOWN_APPS_FILE, 'r') as f:
                known_apps = json.load(f)
                known_apps = {k.lower(): v for k, v in known_apps.items()} # Ensure lowercase keys
            logger.info(f"Loaded {len(known_apps)} known applications from {KNOWN_APPS_FILE}")
        else:
            logger.info(f"{KNOWN_APPS_FILE} not found. Creating and starting with an empty app list.")
            known_apps = {}
            with open(KNOWN_APPS_FILE, 'w') as f: json.dump({}, f) # Create empty file
    except json.JSONDecodeError:
        logger.error(f"Error decoding JSON from {KNOWN_APPS_FILE}. Starting with empty list.", exc_info=True)
        known_apps = {}
    except Exception as e:
        logger.error(f"Error loading known apps: {e}", exc_info=True)
        known_apps = {}

def save_known_apps():
    global known_apps
    try:
        apps_to_save = {k.lower(): v for k, v in known_apps.items()}
        with open(KNOWN_APPS_FILE, 'w') as f:
            json.dump(apps_to_save, f, indent=4) # Pretty print
        logger.info(f"Saved known applications to {KNOWN_APPS_FILE}")
    except Exception as e:
        logger.error(f"Error saving known apps: {e}", exc_info=True)

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app, origins=["null", "file://"], supports_credentials=True)
logger.info("Flask app initialized with CORS.")

# --- Gemini AI Setup ---
gemini_model = None
try:
    genai.configure(api_key=API_KEY)
    gemini_model = genai.GenerativeModel(
        'gemini-1.5-flash',
         safety_settings={ # Example safety settings
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        }
    )
    logger.info("Gemini model 'gemini-1.5-flash' initialized successfully.")
except Exception as e:
    logger.error(f"Fatal error initializing Gemini: {e}", exc_info=True)
    sys.exit("Exiting: Gemini initialization failed.")

# --- Vosk STT Setup ---
vosk_model = None
samplerate = None
try:
    if os.path.exists(VOSK_MODEL_PATH):
        vosk_model = vosk.Model(VOSK_MODEL_PATH)
        try:
            device_info = sd.query_devices(kind='input')
            samplerate = int(device_info['default_samplerate']) if device_info and 'default_samplerate' in device_info else 16000
            logger.info(f"Determined samplerate: {samplerate} Hz")
        except Exception as sd_err:
             logger.warning(f"Could not determine samplerate via sounddevice: {sd_err}. Falling back to 16000 Hz.")
             samplerate = 16000
        logger.info(f"Vosk model loaded successfully from {VOSK_MODEL_PATH}.")
    else:
        logger.warning("Vosk model is not available. Voice input will be disabled.")
except Exception as e:
    logger.error(f"Error initializing Vosk: {e}", exc_info=True)

# --- Helper Function for JSON Error Responses ---
def make_error_response(message, status_code, details=None):
    response_data = {"error": message}
    if details: response_data["details"] = str(details)
    return jsonify(response_data), status_code

# --- Helper function to check for URL patterns ---
def is_likely_url(text):
    text = text.lower()
    # Basic check for http/https or www.domain.tld / domain.tld
    if text.startswith("http://") or text.startswith("https://") or \
       re.search(r'^(www\.)?[\w\-.~:/?#[\]@!$&\'()*+,;=]+\.[\w]+(\b|/)', text):
         # Relaxed regex to match domain.tld structure broadly
        return True
    return False

# --- API Endpoints ---

@app.route('/')
def index():
    return "Zenith Assistant Backend v1.2 (Using Gemini with App/Web Control)"

# --- Core Query Endpoint (Handles Commands & Gemini Streaming) ---
@app.route('/ask_stream', methods=['POST'])
def ask_gemini_stream():
    if not gemini_model: return make_error_response("Gemini model not available", 503)

    data = request.get_json()
    if not data or 'query' not in data: return make_error_response("Missing 'query'", 400)

    query = data.get('query', '').strip()
    logger.info(f"Received query for Zenith: {query[:100]}...")

    # <<<--- Command Handling: "open" --- >>>
    if query.lower().startswith("open "):
        target = query[len("open "):].strip()
        if not target: return make_error_response("Please specify what to open.", 400)

        logger.info(f"Processing 'open' command for target: '{target}'")
        app_name_lower = target.lower()

        # 1. Check Known Applications
        if app_name_lower in known_apps:
            app_path = known_apps[app_name_lower]
            logger.info(f"Found known app '{target}' path: {app_path}")
            try:
                subprocess.Popen([app_path]) # Non-blocking launch
                logger.info(f"Launched application: {app_path}")
                return jsonify({"status": "handled", "response": f"Okay, launching {target}."})
            except FileNotFoundError:
                logger.error(f"Executable not found at path: {app_path} for app '{target}'. Removing entry.")
                del known_apps[app_name_lower]
                save_known_apps()
                return jsonify({"status": "app_not_found", "app_name": target, "error_hint": "The saved path seems incorrect. Please provide the path again."})
            except PermissionError:
                 logger.error(f"Permission denied launching {app_path}", exc_info=True)
                 return jsonify({"status": "error", "response": f"Sorry, I don't have permission to launch {target} from '{app_path}'."})
            except Exception as e:
                logger.error(f"Failed to launch application {app_path}: {e}", exc_info=True)
                return jsonify({"status": "error", "response": f"Sorry, I couldn't launch {target}. An error occurred."})

        # 2. Check if it's likely a Website/URL
        elif is_likely_url(target):
            logger.info(f"Target '{target}' detected as URL.")
            try:
                url_to_open = target if target.startswith("http") else "https://" + target
                webbrowser.open(url_to_open, new=2) # new=2: new tab if possible
                logger.info(f"Opened URL in browser: {url_to_open}")
                return jsonify({"status": "handled", "response": f"Okay, opening {target} in your web browser."})
            except Exception as e:
                logger.error(f"Failed to open URL {target}: {e}", exc_info=True)
                return jsonify({"status": "error", "response": f"Sorry, I couldn't open {target} in the browser."})

        # 3. App Not Found - Ask Frontend to Prompt
        else:
            logger.info(f"Application or URL '{target}' not known. Requesting path from user.")
            return jsonify({"status": "app_not_found", "app_name": target})

    # <<<--- End of Command Handling --->>>

    # --- If not 'open' command, forward to Gemini ---
    logger.info("Query not an 'open' command, forwarding to Gemini.")
    def generate_chunks():
        try:
            full_prompt = f"{SYSTEM_PROMPT}\n\nUser: {query}"
            stream = gemini_model.generate_content(full_prompt, stream=True)
            for chunk in stream:
                if chunk.text:
                    yield chunk.text + "\n" # Newline delimiter for frontend parsing
                if chunk.prompt_feedback and chunk.prompt_feedback.block_reason:
                    block_reason = chunk.prompt_feedback.block_reason.name
                    logger.warning(f"Content generation stopped: {block_reason}")
                    yield f"ERROR: Content blocked ({block_reason})\n"
                    return
        except Exception as e:
            logger.error(f"Error during Gemini streaming: {e}", exc_info=True)
            yield f"ERROR: An error occurred during generation: {str(e)}\n"

    # Return streaming text response
    return Response(stream_with_context(generate_chunks()), mimetype='text/plain; charset=utf-8')

# --- Endpoint to Add/Update Application Paths ---
@app.route('/add_app', methods=['POST'])
def add_app():
    global known_apps
    data = request.get_json()
    if not data or 'app_name' not in data or 'app_path' not in data:
        return make_error_response("Missing 'app_name' or 'app_path'", 400)

    app_name = data['app_name'].strip()
    app_path = data['app_path'].strip()
    app_name_lower = app_name.lower()

    logger.info(f"Received request to add/update app: '{app_name}' path: '{app_path}'")

    # Basic Validation (adjust checks for non-Windows if needed)
    if not app_path: return make_error_response("Application path cannot be empty", 400)
    if '"' in app_path: app_path = app_path.replace('"', '') # Remove quotes if user included them

    if not os.path.exists(app_path):
        logger.error(f"Validation failed: Path does not exist: {app_path}")
        return make_error_response(f"Path not found: '{app_path}'. Please provide the full, correct path.", 400)
    if not os.path.isfile(app_path):
        logger.error(f"Validation failed: Path is not a file: {app_path}")
        return make_error_response(f"Path is not a file: '{app_path}'. It should point to the executable.", 400)
    # (Optional) Add specific OS checks like .exe on Windows
    # if sys.platform == "win32" and not app_path.lower().endswith(".exe"):
    #     logger.warning(f"Path '{app_path}' for Windows doesn't end with .exe")

    try:
        known_apps[app_name_lower] = app_path
        save_known_apps()
        logger.info(f"Application '{app_name}' path saved.")
        return jsonify({"status": "success", "response": f"Okay, I've learned the path for '{app_name}'. You can now ask me to open it."})
    except Exception as e:
        logger.error(f"Failed to save application '{app_name}': {e}", exc_info=True)
        return make_error_response("Internal error saving the application path.", 500, details=e)


# --- Image Analysis Endpoint (Updated with System Prompt) ---
@app.route('/analyze_image', methods=['POST'])
def analyze_image():
    if not gemini_model: return make_error_response("Gemini model unavailable", 503)

    data = request.get_json()
    query = data.get('query', "Describe this image. Solve any questions shown.")
    image_data_uri = data.get('image_data')

    if not image_data_uri: return make_error_response("No image data provided", 400)
    logger.info(f"Received image analysis request for Zenith. Query: {query[:100]}...")

    try:
        header, encoded = image_data_uri.split(",", 1)
        image_data = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(image_data))
        logger.info(f"Decoded image successfully. Format: {image.format}")

        full_text_prompt = f"{SYSTEM_PROMPT}\n\nUser: {query}" # Add system prompt
        prompt_parts = [ full_text_prompt, image ]
        response = gemini_model.generate_content(prompt_parts)

        if response.prompt_feedback and response.prompt_feedback.block_reason:
            block_reason = response.prompt_feedback.block_reason.name
            logger.warning(f"Image analysis blocked: {block_reason}")
            return make_error_response("Content blocked by safety filter", 400, details=block_reason)

        logger.info(f"Zenith image analysis response: {response.text[:100]}...")
        return jsonify({"response": response.text}) # Return JSON

    except (ValueError, TypeError, base64.binascii.Error, UnidentifiedImageError) as img_err:
         logger.error(f"Error processing image data: {img_err}", exc_info=True)
         return make_error_response(f"Invalid image data/format ({type(img_err).__name__})", 400, details=img_err)
    except Exception as e:
         logger.error(f"Error analyzing image with Gemini: {e}", exc_info=True)
         return make_error_response("Error during image analysis", 500, details=e)


# --- Voice Recognition Endpoint ---
@app.route('/listen', methods=['POST'])
def listen_for_speech():
    if not vosk_model: return make_error_response("Voice model unavailable.", 503)
    if not samplerate: return make_error_response("Cannot determine audio samplerate.", 500)

    listen_duration = 5
    logger.info(f"Listening for speech ({listen_duration} seconds)...")

    recognizer = vosk.KaldiRecognizer(vosk_model, samplerate)
    recognizer.SetWords(False)
    transcript = ""
    audio_data = []

    try:
        def audio_callback(indata, frames, time, status):
            if status: logger.warning(f"Sounddevice status: {status}")
            audio_data.append(bytes(indata))

        with sd.InputStream(callback=audio_callback, samplerate=samplerate, channels=1, dtype='int16', blocksize=8000):
             sd.sleep(listen_duration * 1000)

        logger.info(f"Recording finished. Processing {len(audio_data)} audio chunks.")
        if not audio_data:
             logger.warning("No audio data captured.")
             return jsonify({"transcript": ""})

        full_audio = b"".join(audio_data)
        if recognizer.AcceptWaveform(full_audio):
            result = json.loads(recognizer.Result())
            transcript = result.get('text', '')
        else:
             final_result = json.loads(recognizer.FinalResult())
             transcript = final_result.get('text', '')

        logger.info(f"Transcription: '{transcript}'")
        return jsonify({"transcript": transcript})

    except sd.PortAudioError as pa_err:
        logger.error(f"PortAudioError: {pa_err}", exc_info=True)
        if "Invalid device" in str(pa_err) or "No Default Input Device" in str(pa_err):
             return make_error_response("Microphone not found or PortAudio error.", 500, details="Check connection/settings.")
        return make_error_response("Audio device error.", 500, details=pa_err)
    except Exception as e:
        logger.error(f"Speech recognition error: {e}", exc_info=True)
        return make_error_response("Speech recognition failed.", 500, details=e)

# --- Main Execution ---
if __name__ == '__main__':
    print("Initializing Zenith Backend...")
    load_known_apps() # Load apps on start
    logger.info("Starting Flask backend server for Zenith...")
    # Use 127.0.0.1 for local access only
    app.run(host='127.0.0.1', port=5111, debug=False) # Debug=False recommended