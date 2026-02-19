# routes/routes_ai_chat.py
import os
import json
import uuid
import logging
import time
from pathlib import Path
from flask import Blueprint, request, jsonify, session, render_template, Response, stream_with_context
import google.generativeai as genai

ai_chat_bp = Blueprint('ai_chat', __name__, template_folder='../templates')

# Action logger will be initialized by the main app
action_logger = None
_conversations_dir = None

def init_ai_chat_routes(al, instance_path=None):
    """Initialize the blueprint with managers from the main app."""
    global action_logger, _conversations_dir
    action_logger = al
    if instance_path:
        _conversations_dir = os.path.join(instance_path, 'conversations')
        os.makedirs(_conversations_dir, exist_ok=True)

def _get_conversations_dir():
    """Get the conversations directory, creating it if needed."""
    if _conversations_dir and os.path.isdir(_conversations_dir):
        return _conversations_dir
    return None

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


# ─── Page Route ───────────────────────────────────────────────────────────────

@ai_chat_bp.route('/chat')
def chat_page():
    """Render the BugByte chat page."""
    is_admin = session.get('admin_logged_in', False)
    return render_template('chat.html', is_admin=is_admin)


# ─── Legacy API (non-streaming, kept for backwards compat on index page) ──────

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


# ─── Streaming API ────────────────────────────────────────────────────────────

@ai_chat_bp.route('/api/ai-chat/stream', methods=['POST'])
def ai_chat_stream():
    """Stream AI chat responses using Server-Sent Events (SSE)."""
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
    
    history = data.get('history', [])
    
    def generate():
        try:
            chat = model.start_chat(history=history)
            response = chat.send_message(user_message, stream=True)
            
            full_response = []
            for chunk in response:
                if chunk.text:
                    full_response.append(chunk.text)
                    # Send each chunk as an SSE event
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk.text})}\n\n"
            
            # Send completion event
            full_text = ''.join(full_response)
            yield f"data: {json.dumps({'type': 'done', 'content': full_text})}\n\n"
            
            # Log the interaction
            if action_logger:
                action_logger.log(
                    request.remote_addr,
                    'AI_CHAT_STREAM',
                    {
                        'message_length': len(user_message),
                        'response_length': len(full_text)
                    }
                )
                
        except Exception as e:
            logging.error(f"Error in streaming AI chat: {e}")
            error_message = str(e)
            if "API_KEY" in error_message.upper():
                error_message = "Invalid API key. Please check your GEMINI_API_KEY configuration."
            elif "QUOTA" in error_message.upper():
                error_message = "API quota exceeded. Please try again later."
            elif "SAFETY" in error_message.upper():
                error_message = "Message blocked by safety filters. Please rephrase your message."
            else:
                error_message = f"AI service error: {error_message}"
            yield f"data: {json.dumps({'type': 'error', 'content': error_message})}\n\n"
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )


# ─── Conversations CRUD ──────────────────────────────────────────────────────

@ai_chat_bp.route('/api/conversations', methods=['GET'])
def list_conversations():
    """List all saved conversations (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(conversations=[])
    
    conversations = []
    for filename in os.listdir(conv_dir):
        if filename.endswith('.json'):
            filepath = os.path.join(conv_dir, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                conversations.append({
                    'id': data.get('id', filename.replace('.json', '')),
                    'title': data.get('title', 'Untitled'),
                    'created_at': data.get('created_at', 0),
                    'updated_at': data.get('updated_at', 0),
                    'message_count': len(data.get('messages', []))
                })
            except (json.JSONDecodeError, IOError):
                continue
    
    # Sort by most recently updated
    conversations.sort(key=lambda x: x['updated_at'], reverse=True)
    return jsonify(conversations=conversations)


@ai_chat_bp.route('/api/conversations', methods=['POST'])
def create_conversation():
    """Create a new conversation (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(error="Storage not available"), 500
    
    data = request.get_json() or {}
    conv_id = str(uuid.uuid4())[:8]
    now = time.time()
    
    conversation = {
        'id': conv_id,
        'title': data.get('title', 'New Chat'),
        'created_at': now,
        'updated_at': now,
        'messages': []
    }
    
    filepath = os.path.join(conv_dir, f"{conv_id}.json")
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(conversation, f, ensure_ascii=False, indent=2)
    
    return jsonify(conversation), 201


@ai_chat_bp.route('/api/conversations/<conv_id>', methods=['GET'])
def get_conversation(conv_id):
    """Get a specific conversation with its messages (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(error="Storage not available"), 500
    
    filepath = os.path.join(conv_dir, f"{conv_id}.json")
    if not os.path.exists(filepath):
        return jsonify(error="Conversation not found"), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except (json.JSONDecodeError, IOError) as e:
        return jsonify(error=f"Failed to read conversation: {e}"), 500


@ai_chat_bp.route('/api/conversations/<conv_id>', methods=['PUT'])
def update_conversation(conv_id):
    """Update conversation metadata (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(error="Storage not available"), 500
    
    filepath = os.path.join(conv_dir, f"{conv_id}.json")
    if not os.path.exists(filepath):
        return jsonify(error="Conversation not found"), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        update_data = request.get_json() or {}
        if 'title' in update_data:
            data['title'] = update_data['title']
        data['updated_at'] = time.time()
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify(data)
    except (json.JSONDecodeError, IOError) as e:
        return jsonify(error=f"Failed to update conversation: {e}"), 500


@ai_chat_bp.route('/api/conversations/<conv_id>', methods=['DELETE'])
def delete_conversation(conv_id):
    """Delete a conversation (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(error="Storage not available"), 500
    
    filepath = os.path.join(conv_dir, f"{conv_id}.json")
    if not os.path.exists(filepath):
        return jsonify(error="Conversation not found"), 404
    
    try:
        os.remove(filepath)
        return jsonify(success=True, message="Conversation deleted")
    except IOError as e:
        return jsonify(error=f"Failed to delete conversation: {e}"), 500


@ai_chat_bp.route('/api/conversations/<conv_id>/messages', methods=['PUT'])
def save_messages(conv_id):
    """Save/update messages for a conversation (admin only)."""
    if not session.get('admin_logged_in', False):
        return jsonify(error="Admin access required"), 403
    conv_dir = _get_conversations_dir()
    if not conv_dir:
        return jsonify(error="Storage not available"), 500
    
    filepath = os.path.join(conv_dir, f"{conv_id}.json")
    if not os.path.exists(filepath):
        return jsonify(error="Conversation not found"), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        update_data = request.get_json() or {}
        if 'messages' in update_data:
            data['messages'] = update_data['messages']
        if 'title' in update_data:
            data['title'] = update_data['title']
        data['updated_at'] = time.time()
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify(success=True)
    except (json.JSONDecodeError, IOError) as e:
        return jsonify(error=f"Failed to save messages: {e}"), 500
