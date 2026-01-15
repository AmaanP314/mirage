import os
import json
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv
load_dotenv()

if not os.getenv("GOOGLE_API_KEY"):
    print("WARNING: GOOGLE_API_KEY not found. Please set it in .env or environment variables.")

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LLM SETUP ---
llm = ChatGoogleGenerativeAI(
    model="gemini-flash-lite-latest",
    temperature=0.7,
    convert_system_message_to_human=True
)

SYSTEM_PROMPT = """You are a highly advanced 3D Digital Human. 
Your name is Mirage. You are friendly, concise, and helpful.
You are conversing with a user via voice interaction.
Keep your responses relatively short (1-3 sentences) to maintain a natural conversational flow, unless asked for a detailed explanation.
Do not use emojis as they cannot be spoken by the TTS engine.
"""

# --- WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

manager = ConnectionManager()

@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print("Client connected via WebSocket")

    full_history: List[Dict[str, str]] = []
    
    try:
        while True:
            # 1. Receive User Input
            data = await websocket.receive_text()
            print(f"User: {data}")
            
            # Update History
            full_history.append({"role": "user", "content": data})
            
            # 2. Prepare Context for LLM (System + Last 3 turns / 6 messages)
            messages = [SystemMessage(content=SYSTEM_PROMPT)]
            
            # Slice last 6 messages from full history
            recent_history = full_history[-6:] if len(full_history) > 6 else full_history
            
            for msg in recent_history:
                if msg["role"] == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                else:
                    messages.append(AIMessage(content=msg["content"]))
            
            # 3. Invoke LLM
            print("Thinking...")
            try:
                response = await llm.ainvoke(messages)
                ai_text = response.content
            except Exception as e:
                print(f"LLM Error: {e}")
                ai_text = "I apologize, I'm having trouble processing that right now."
            
            print(f"AI: {ai_text}")
            
            # Update History
            full_history.append({"role": "ai", "content": ai_text})
            
            # 4. Send Response
            response_payload = {
                "type": "audio_response", 
                "text": ai_text,
                "history_snapshot": full_history 
            }
            
            await websocket.send_json(response_payload)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("Client disconnected")
    except Exception as e:
        print(f"Unexpected Error: {e}")
        try:
            manager.disconnect(websocket)
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    print("Starting Mirage Server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
