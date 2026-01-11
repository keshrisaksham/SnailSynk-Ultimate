# routes/routes_ai_chat.py
import os
import logging
from flask import Blueprint, request, jsonify, session
import google.generativeai as genai

ai_chat_bp = Blueprint('ai_chat', __name__, template_folder='../templates')

# Action logger will be initialized by the main app
action_logger = None

def init_ai_chat_routes(al):
    """Initialize the blueprint with managers from the main app."""
    global action_logger
    action_logger = al

def get_gemini_model():
    """Get or initialize the Gemini model. Called at runtime to ensure .env is loaded."""
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    if not GEMINI_API_KEY:
        return None
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        return genai.GenerativeModel('gemini-2.5-flash')
    except Exception as e:
        logging.error(f"Failed to initialize Gemini model: {e}")
        return None

@ai_chat_bp.route('/api/ai-chat', methods=['POST'])
def ai_chat():
    """Handle AI chat messages using Google Gemini."""
    model = get_gemini_model()
    
    if not model:
        return jsonify(
            success=False, 
            error="AI chat is not configured. Please add GEMINI_API_KEY to your environment variables."
        ), 503
    
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify(success=False, error="Invalid request. Message is required."), 400
    
    user_message = data['message'].strip()
    if not user_message:
        return jsonify(success=False, error="Message cannot be empty."), 400
    
    # Get conversation history if provided
    history = data.get('history', [])
    
    try:
        # Start a chat session with history
        chat = model.start_chat(history=history)
        
        # Send the message and get response
        response = chat.send_message(user_message)
        
        # Log the interaction
        if action_logger:
            action_logger.log(
                request.remote_addr, 
                'AI_CHAT', 
                {
                    'message_length': len(user_message),
                    'response_length': len(response.text)
                }
            )
        
        return jsonify(
            success=True,
            response=response.text,
            message="AI response generated successfully."
        )
    
    except Exception as e:
        logging.error(f"Error in AI chat: {e}")
        error_message = str(e)
        
        # Provide user-friendly error messages
        if "API_KEY" in error_message.upper():
            error_message = "Invalid API key. Please check your GEMINI_API_KEY configuration."
        elif "QUOTA" in error_message.upper():
            error_message = "API quota exceeded. Please try again later."
        elif "SAFETY" in error_message.upper():
            error_message = "Message blocked by safety filters. Please rephrase your message."
        else:
            error_message = f"AI service error: {error_message}"
        
        return jsonify(success=False, error=error_message), 500
