import queue
import threading
import time

import streamlit as st
import websocket

WS_URL = "ws://localhost:8080"

st.set_page_config(
    page_title="Cascade Mobile",
    page_icon="🌊",
    layout="centered",
)

st.markdown("""
<style>
    /* Tighten up on mobile */
    .block-container { padding: 1rem 1rem 6rem; max-width: 700px; }
    /* User bubble */
    .msg-user {
        background: #1e6ef5;
        color: #fff;
        border-radius: 18px 18px 4px 18px;
        padding: 10px 14px;
        margin: 6px 0 6px auto;
        max-width: 80%;
        width: fit-content;
        text-align: left;
    }
    /* Assistant bubble */
    .msg-assistant {
        background: #2d2d2d;
        color: #e8e8e8;
        border-radius: 18px 18px 18px 4px;
        padding: 10px 14px;
        margin: 6px auto 6px 0;
        max-width: 80%;
        width: fit-content;
        white-space: pre-wrap;
    }
    .msg-label {
        font-size: 0.7rem;
        color: #888;
        margin-bottom: 2px;
    }
    .stSpinner > div { margin: 0 auto; }
</style>
""", unsafe_allow_html=True)

st.title("🌊 Cascade Mobile")


def init_state():
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "waiting" not in st.session_state:
        st.session_state.waiting = False


def send_prompt(prompt: str) -> str | None:
    """Send prompt over WebSocket, block until response or timeout (90 s)."""
    result_q: queue.Queue[str | Exception] = queue.Queue()

    def run():
        try:
            ws = websocket.create_connection(WS_URL, timeout=10)
            import json
            ws.send(json.dumps({"type": "execute_prompt", "prompt": prompt}))
            ws.settimeout(90)
            while True:
                raw = ws.recv()
                msg = json.loads(raw)
                if msg.get("type") == "response":
                    result_q.put(msg.get("content", ""))
                    break
                elif msg.get("type") == "error":
                    result_q.put(Exception(msg.get("message", "Unknown error")))
                    break
            ws.close()
        except Exception as exc:
            result_q.put(exc)

    t = threading.Thread(target=run, daemon=True)
    t.start()

    placeholder = st.empty()
    elapsed = 0
    while result_q.empty():
        placeholder.markdown(f"⏳ Waiting for Cascade… ({elapsed}s)")
        time.sleep(1)
        elapsed += 1
        if elapsed > 95:
            placeholder.empty()
            return None
    placeholder.empty()

    result = result_q.get()
    if isinstance(result, Exception):
        st.error(f"Error: {result}")
        return None
    return result


init_state()

# Render message history
for msg in st.session_state.messages:
    role = msg["role"]
    content = msg["content"]
    if role == "user":
        st.markdown(f'<div class="msg-label" style="text-align:right">You</div><div class="msg-user">{content}</div>', unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="msg-label">Cascade</div><div class="msg-assistant">{content}</div>', unsafe_allow_html=True)

# Input
with st.form("chat_form", clear_on_submit=True):
    cols = st.columns([5, 1])
    user_input = cols[0].text_input(
        "Message",
        placeholder="Ask Cascade anything…",
        label_visibility="collapsed",
        disabled=st.session_state.waiting,
    )
    submitted = cols[1].form_submit_button("Send", use_container_width=True)

if submitted and user_input.strip():
    prompt = user_input.strip()
    st.session_state.messages.append({"role": "user", "content": prompt})
    st.session_state.waiting = True
    st.rerun()

if st.session_state.waiting:
    last_user = next(
        (m["content"] for m in reversed(st.session_state.messages) if m["role"] == "user"),
        None,
    )
    if last_user:
        response = send_prompt(last_user)
        st.session_state.waiting = False
        if response:
            st.session_state.messages.append({"role": "assistant", "content": response.strip()})
        st.rerun()
