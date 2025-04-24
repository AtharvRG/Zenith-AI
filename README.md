# Zenith AI ✨ Desktop Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub repo size](https://img.shields.io/github/repo-size/AtharvRG/Zenith-AI)](https://github.com/AtharvRG/Zenith-AI)

**A modern desktop AI assistant powered by Google Gemini, featuring voice control, image analysis, app/web control, note-taking, clipboard integration, and customizable themes.**

<!-- It's highly recommended to replace this with an actual screenshot or GIF! -->
<!--![Zenith Screenshot Placeholder](https://via.placeholder.com/600x400/4A4A4A/FFFFFF?text=Add+Zenith+Screenshot+Here)-->
<!--*(Screenshot/GIF Coming Soon)*-->

---

## Features

*   **AI Powered by Gemini:** Uses the powerful `gemini-2.0-flash` model for text generation and multimodal analysis.
*   **Multimodal Input:**
    *   **Text Input:** Type queries directly.
    *   **Voice Input:** Offline Speech-to-Text using Vosk (microphone required).
    *   **Image/Webcam Analysis:** Ask questions about images captured from your webcam (webcam required). Solves math problems, describes scenes, etc.
    *   **Clipboard Processing:** Analyze or summarize text directly from your clipboard with a button click. $${\color{red}(Having}$$ $${\color{red}issues...)}$$
*   **Interactive Output:**
    *   **Streaming Responses:** AI answers stream in token-by-token for a dynamic feel.
    *   **Markdown Rendering:** Responses are formatted using Markdown (bold, italics, lists, code blocks).
    *   **Code Block Copy:** Easily copy code snippets from AI responses.
*   **Desktop Control & Automation:**
    *   **Application Launch:** Open known applications using the `open <app_name>` command. Learns paths for unknown apps interactively.
    *   **Web Browsing:**
        *   Open known websites (`open youtube`).
        *   Open any URL (`open google.com`).
        *   Perform specific site searches (`search wikipedia for electron`, `open youtube funny cats`).
        *   Perform generic web searches (`search for latest AI news`).
    *   **Note Taking:** Save quick notes locally using `note: <your note>` or `remember: <your task>`.
*   **Modern UI & Customization:**
    *   **Glassmorphism Theme:** Default semi-transparent blurred background (OS support required).
    *   **Multiple Themes:** Choose from Glass, Dark, Light, Ocean, Forest, Rose, Purple, Crimson, and Nord themes via the Settings panel.
    *   **Settings Panel:** Configure theme and toggle voice input auto-send behaviour.
*   **Conversation Context:** Remembers the last few turns of the conversation for more relevant follow-up responses.
*   **Connection Status:** Visual indicator shows if the frontend is connected to the Python backend.

## Tech Stack

*   **Frontend:** Electron, HTML, CSS, JavaScript
*   **Backend:** Python 3.10 (You can use any version 3.8+), Flask
*   **AI Model:** Google Gemini API (`gemini-2.0-flash`)
*   **Speech-to-Text:** Vosk (Offline)
*   **UI Rendering:** Marked.js (for Markdown)

## Prerequisites

*   **Node.js & npm:** Required for Electron development (LTS version recommended). [Download Node.js](https://nodejs.org/)
*   **Python:** Version 3.8 or higher recommended. [Download Python](https://www.python.org/)
*   **pip:** Python package installer (usually included with Python).
*   **Git:** For cloning the repository. [Download Git](https://git-scm.com/)
*   **Google AI Studio API Key:** You **must** obtain an API key for the Gemini API. [Get API Key](https://aistudio.google.com/app/apikey)
*   **(Optional) Microphone:** Required for voice input features.
*   **(Optional) Webcam:** Required for image analysis features.
*   **(Optional) OS Transparency Effects:** Required for the default "Glass" theme to render correctly (e.g., Windows Aero, macOS transparency). Other themes work without it.

## Setup Instructions (Windows Only)

Follow these steps to get Zenith running locally:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/AtharvRG/Zenith-AI.git
    cd Zenith-AI
    ```

2.  **Backend Setup (Python):**
    *   **Create a Virtual Environment (Recommended):**
        ```bash
        # Windows Only
        python -m venv venv
        .\venv\Scripts\activate
        ```
    *   **Install Python Dependencies:**
        ```bash
        pip install -r backend/requirements.txt
        ```
    *   **Download Vosk Model:**
        *   Go to the [Vosk Models Page](https://alphacephei.com/vosk/models).
        *   Download a model suitable for your language (e.g., `vosk-model-small-en-us-0.15` for English - smaller is faster but less accurate).
        *   **Crucially:** Extract the downloaded archive. You should have a folder containing files like `am/`, `conf/`, `graph/`, etc.
        *   Rename this extracted folder to simply `model`.
        *   Place this `model` folder *inside* the `backend/vosk_model/` directory.
        *   The final structure **must** be: `backend/vosk_model/model/` (containing the actual model files).

3.  **Frontend Setup (Node.js):**
    *   **Install Node Dependencies:**
        ```
        npm install
        ```
    *   **Download Marked.js:** 
        *   Go to [Marked.js GitHub Releases](https://github.com/markedjs/marked/releases) or the [Marked.js website](https://marked.js.org/).
        *   Download the `marked.min.js` file.
        *   Place this file inside the `src/renderer/assets/` directory.
        *   **NOTE: marked.min.js is already present in the repo.**

## Configuration

1.  **Google Gemini API Key:** (For FREE)
    *   Create a file named `.env` in the **root** directory of the project (the same level as `package.json`).
    *   Add your API key to this file:
        ```env
        # Replace YOUR_ACTUAL_API_KEY_HERE with the key you obtained
        GEMINI_API_KEY=YOUR_ACTUAL_API_KEY_HERE
        Example: GEMINI_API_KEY=abcdefghijklmnopqrstuvwxyz
        # assuming abcdefghijklmnopqrstuvwxyz is your API KEY
        ```
    *   **Important:** This `.env` file is listed in `.gitignore` and should **never** be committed to version control. Keep your API key secret.

2.  **Known Applications (`backend/known_apps.json`):**
    *   This file stores paths to applications you want Zenith to open directly via the `open <app_name>` command.
    *   The format is a JSON object with lowercase application names as keys and the full path to the executable as values.
    *   Example:
        ```json
        {
            "notepad": "C:\\Windows\\System32\\notepad.exe",
            "vscode": "C:\\Users\\YourUser\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
            "firefox": "/usr/bin/firefox.exe",
            "...Keyword...": "...Executable filepath..."
        }
        ```
    *   **Learning Paths:** If you try `open myapp` and Zenith doesn't know it, it will ask you for the path. Enter the full, correct path, and Zenith will save it to this file automatically. $${\color{red}(In}$$ $${\color{red}Development...)}$$
    *   **Path Format:** Use the correct path separator for your OS (e.g., `\` for Windows, `/` for macOS/Linux). You might need to escape backslashes in the JSON (`\\`). If unsure, the interactive learning feature is the easiest way.

3.  **Known Websites (`backend/known_websites.json`):**
    *   Pre-populate this file with common websites you want to open directly via `open <site_name>`.
    *   Format is `lowercase_site_name`: `"full_url"`.
    *   The backend also includes templates for searching common sites (see `SITE_SEARCH_TEMPLATES` in `app.py`).
    *   Example:
        ```json
        {
            "google": "https://www.google.com",
            "github": "https://www.github.com",
            "bbc news": "https://www.bbc.com/news"
        }
        ```

## Usage

1.  **Start the Application:**
    *   Make sure your Python virtual environment is activated (if you used one).
    *   Open your terminal in the project's **root** directory.
    *   Run the start script:
        ```bash
        
        npm start
        
        ```
    *   This uses `concurrently` to start both the Python Flask backend and the Electron frontend application simultaneously.

2.  **Interacting with Zenith:**
    *   **Text:** Type your query in the input box and press Enter or click `▲`.
    *   **Voice:** Click the microphone icon (`🎤`), speak your query, and Zenith will process it (auto-send behavior depends on Settings).
    *   **Webcam:** Click the camera icon (`📸`) to activate the webcam. Click again to capture and analyze the image along with any text in the input box.
    *   **Clipboard:** Click the clipboard icon (`📋`) to send the current text content of your clipboard to Zenith for analysis/summarization.
    *   **Open Apps/Sites/URLs:** Use `open <app_name | site_name | URL>`.
        *   `open notepad`
        *   `open youtube`
        *   `open google.com`
    *   **Web Search:** Use `search <query>`, `google <query>`, or specific site searches like `search youtube <query>`.
        *   `search for electron builders`
        *   `open youtube trailer for dune 2`
        *   `search wikipedia for python`
    *   **Note Taking:** Use `note: <your note>` or `remember: <your task>`.
        *   `note: meeting tomorrow at 10 AM`
        *   `remember: buy groceries`
    *   **Settings:** Click the gear icon (`⚙️`) to open the settings panel, change themes, or toggle voice auto-send.

## Contributing

Contributions are welcome! If you find bugs or have ideas for improvements, please:

1.  Check for existing [Issues](https://github.com/AtharvRG/Zenith-AI/issues).
2.  If the issue doesn't exist, create a new one.
3.  For code contributions, please fork the repository and submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file (if you create one) for details.

## Acknowledgements

*   Google Gemini API
*   Electron Framework
*   Vosk Offline Speech Recognition
*   Flask Microframework
*   Marked.js Library
*   SoundDevice Library
*   Pillow Library

---

Enjoy using Zenith AI! ✨
