import http.server
import socketserver
import json
import sqlite3
import os
import urllib.parse

PORT = 8000
DB_NAME = "aether.db"
JSON_FILE = "aether_data.json"

def get_db_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)

def get_json_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), JSON_FILE)

# 未読メッセージを JSON ファイルにミラーリング出力する関数
def update_unread_json():
    db_path = get_db_path()
    json_path = get_json_path()
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        # Ellie宛ての未読メッセージを取得
        cursor.execute(
            "SELECT sender, payload FROM messages WHERE receiver = 'Ellie' AND is_read = 0 ORDER BY timestamp ASC;"
        )
        rows = cursor.fetchall()
        
        if not rows:
            data = {"has_unread": False, "messages": []}
        else:
            messages = []
            for row in rows:
                p_str = row["payload"]
                try:
                    p_json = json.loads(p_str)
                except ValueError:
                    p_json = {"text": p_str}
                messages.append({
                    "sender": row["sender"],
                    "text": p_json.get("text", "")
                })
            data = {"has_unread": True, "messages": messages}
            
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print(f"[Aether Server] Error updating unread JSON: {e}")
    finally:
        conn.close()

class AetherAPIHandler(http.server.BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/send':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                sender = data.get('sender')
                receiver = data.get('receiver')
                msg_type = data.get('type', 'chat')
                payload = data.get('payload')
                
                if not sender or not receiver or not payload:
                    self._send_response(400, {"error": "Missing required fields"})
                    return
                
                if isinstance(payload, (dict, list)):
                    payload_str = json.dumps(payload, ensure_ascii=False)
                else:
                    payload_str = str(payload)
                
                db_path = get_db_path()
                conn = sqlite3.connect(db_path)
                try:
                    conn.execute("PRAGMA journal_mode=WAL;")
                    conn.execute("PRAGMA busy_timeout = 5000;")
                    cursor = conn.cursor()
                    cursor.execute(
                        "INSERT INTO messages (sender, receiver, msg_type, payload) VALUES (?, ?, ?, ?);",
                        (sender, receiver, msg_type, payload_str)
                    )
                    conn.commit()
                    self._send_response(200, {"success": True, "message_id": cursor.lastrowid})
                finally:
                    conn.close()
                
                # 新しいメッセージが送信されたので、未読JSONを更新
                update_unread_json()
                    
            except Exception as e:
                self._send_response(500, {"error": str(e)})
        elif parsed_url.path == '/save_dsl':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                dsl = data.get('dsl', '')
                
                # aether_dsl.txt に最新のDSLを出力
                dsl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aether_dsl.txt")
                with open(dsl_path, "w", encoding="utf-8") as f:
                    f.write(dsl)
                
                # aether_data.json の現在の値に統合して上書き保存
                json_path = get_json_path()
                current_data = {"has_unread": False, "messages": []}
                if os.path.exists(json_path):
                    try:
                        with open(json_path, "r", encoding="utf-8") as f:
                            current_data = json.load(f)
                    except Exception:
                        pass
                
                current_data["current_dsl"] = dsl
                
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(current_data, f, ensure_ascii=False, indent=2)
                
                self._send_response(200, {"success": True, "message": "DSL saved successfully"})
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_response(500, {"error": str(e)})
        elif parsed_url.path == '/export_viewer':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                dsl = data.get('dsl', '')
                
                dir_path = os.path.dirname(os.path.abspath(__file__))
                
                # Auto-detect and inline local images in DSL (Base64 / SVG inline support)
                import re
                import base64
                
                def inline_image(match):
                    alt = match.group(1)
                    img_path = match.group(2).strip()
                    # Skip web URLs or already inlined data
                    if img_path.startswith(('http://', 'https://', 'data:')):
                        return match.group(0)
                    
                    # Resolve relative path to absolute
                    abs_img_path = img_path if os.path.isabs(img_path) else os.path.join(dir_path, img_path)
                    
                    if os.path.exists(abs_img_path):
                        ext = os.path.splitext(abs_img_path)[1].lower()
                        try:
                            if ext == '.svg':
                                with open(abs_img_path, 'r', encoding='utf-8') as img_f:
                                    svg_content = img_f.read()
                                b64_data = base64.b64encode(svg_content.encode('utf-8')).decode('utf-8')
                                return f"![{alt}](data:image/svg+xml;base64,{b64_data})"
                            elif ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
                                mime = 'image/png' if ext == '.png' else ('image/gif' if ext == '.gif' else ('image/webp' if ext == '.webp' else 'image/jpeg'))
                                with open(abs_img_path, 'rb') as img_f:
                                    img_data = img_f.read()
                                b64_data = base64.b64encode(img_data).decode('utf-8')
                                return f"![{alt}](data:{mime};base64,{b64_data})"
                        except Exception as img_e:
                            print(f"[Aether Export] Failed to inline image {img_path}: {img_e}")
                    return match.group(0)
                
                dsl = re.sub(r'!\[([^\]]*)\]\s*\(([^)]+)\)', inline_image, dsl)
                
                # Load assets
                with open(os.path.join(dir_path, "index.html"), "r", encoding="utf-8") as f:
                    html = f.read()
                with open(os.path.join(dir_path, "style.css"), "r", encoding="utf-8") as f:
                    css = f.read()
                with open(os.path.join(dir_path, "aether_parser.js"), "r", encoding="utf-8") as f:
                    parser_js = f.read()
                with open(os.path.join(dir_path, "aether_renderer.js"), "r", encoding="utf-8") as f:
                    renderer_js = f.read()
                with open(os.path.join(dir_path, "aether_main.js"), "r", encoding="utf-8") as f:
                    main_js = f.read()
                
                # 1. Inline CSS
                css_inline = f"<style>\n{css}\n</style>"
                html = html.replace('<link rel="stylesheet" href="style.css">', css_inline)
                
                # 2. Add Viewer Mode CSS adjustments (Hide chat & dsl tabs, force details visible)
                viewer_css = """
<style>
.tabs-header { display: none !important; }
#tab-chat, #tab-dsl { display: none !important; }
#tab-details { display: flex !important; height: calc(100% - 70px) !important; }
/* Disable zoom indicator in viewer if needed, or keep it */
</style>
"""
                html = html.replace("</head>", f"{viewer_css}\n</head>")
                
                # 3. Embed main.js (We will override window.onload later in the script to avoid duplicate initializations)
                # Safely escape DSL content via JSON serialization to prevent template literal syntax errors in JS
                dsl_json = json.dumps(dsl)
                
                # Use plain placeholder string instead of python f-string to avoid curly brace parsing conflicts
                embedded_onload = """
window.onload = () => {
  const initialDSL = __DSL_JSON_PLACEHOLDER__;
  document.getElementById('dsl-input').value = initialDSL;
  applyDSL();
  console.log("[Aether Viewer] Single-file interactive whiteboard snapshot loaded.");
};
// Disabled API and Chat mechanisms for viewer safety
function pollMessages() {}
async function saveCanvasState() {}
async function handleSendChat() {}
"""
                embedded_onload = embedded_onload.replace("__DSL_JSON_PLACEHOLDER__", dsl_json)
                
                js_combined = f"""<script>
// 1. Parser
{parser_js}

// 2. Renderer
{renderer_js}

// 3. Main
{main_js}

// 4. Onload Initializer
{embedded_onload}
</script>"""
                
                # Replace links with inline JS
                html = html.replace('<script src="aether_parser.js"></script>', '')
                html = html.replace('<script src="aether_renderer.js"></script>', '')
                html = html.replace('<script src="aether_main.js"></script>', js_combined)
                
                # Send the combined HTML as response
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_response(500, {"error": str(e)})
        else:
            self._send_response(404, {"error": "Not Found"})

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        
        if parsed_url.path == '/watch':
            receiver = query_params.get('receiver', [None])[0]
            if not receiver:
                self._send_response(400, {"error": "Missing receiver parameter"})
                return
                
            db_path = get_db_path()
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            try:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute("PRAGMA busy_timeout = 5000;")
                cursor = conn.cursor()
                
                cursor.execute(
                    "SELECT id, timestamp, sender, msg_type, payload FROM messages WHERE receiver = ? AND is_read = 0 ORDER BY timestamp ASC;",
                    (receiver,)
                )
                rows = cursor.fetchall()
                
                messages = []
                message_ids = []
                for row in rows:
                    p_str = row["payload"]
                    try:
                        p_json = json.loads(p_str)
                    except ValueError:
                        p_json = {"text": p_str}
                        
                    messages.append({
                        "id": row["id"],
                        "timestamp": row["timestamp"],
                        "sender": row["sender"],
                        "type": row["msg_type"],
                        "payload": p_json
                    })
                    message_ids.append(row["id"])
                
                if message_ids:
                    placeholders = ",".join("?" for _ in message_ids)
                    cursor.execute(
                        f"UPDATE messages SET is_read = 1 WHERE id IN ({placeholders});",
                        message_ids
                    )
                    conn.commit()
                
                self._send_response(200, messages)
            except Exception as e:
                self._send_response(500, {"error": str(e)})
            finally:
                conn.close()
                
            # メッセージが読み取られて既読になったので、未読JSONを更新
            update_unread_json()
        else:
            self._send_response(404, {"error": "Not Found"})

    def _send_response(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode('utf-8'))

if __name__ == "__main__":
    db_path = get_db_path()
    if not os.path.exists(db_path):
        import db_init
        db_init.init_database(db_path)
        
    # 起動時に一度JSONを最新化
    update_unread_json()
        
    handler = AetherAPIHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"[Aether Server] Running on http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[Aether Server] Shutting down.")
