import asyncio
import json
import os
import logging
import socket
import platform
import subprocess
from datetime import datetime
from functools import partial

from websockets.asyncio.server import serve
from pynput.keyboard import Controller as KeyboardController, Key, KeyCode
from pynput.mouse import Controller as MouseController, Button

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

keyboard = KeyboardController()
mouse = MouseController()

# 全局键盘状态（缓存）
keyboard_state = {
    "num_lock": False,
    "caps_lock": False,
    "scroll_lock": False
}

# 特殊键映射
SPECIAL_KEYS = {
    'enter': Key.enter, 'return': Key.enter, 'backspace': Key.backspace,
    'delete': Key.delete, 'tab': Key.tab, 'space': Key.space, 'esc': Key.esc,
    'escape': Key.esc, 'up': Key.up, 'down': Key.down, 'left': Key.left,
    'right': Key.right, 'shift': Key.shift, 'shift_l': Key.shift_l, 'shift_r': Key.shift_r,
    'ctrl': Key.ctrl, 'ctrl_l': Key.ctrl_l, 'ctrl_r': Key.ctrl_r,
    'alt': Key.alt, 'alt_l': Key.alt_l, 'alt_r': Key.alt_r, 'alt_gr': Key.alt_gr,
    'cmd': Key.cmd, 'win': Key.cmd, 'caps_lock': Key.caps_lock, 'num_lock': Key.num_lock,
    'scroll_lock': Key.scroll_lock, 'page_up': Key.page_up, 'page_down': Key.page_down,
    'home': Key.home, 'end': Key.end, 'insert': Key.insert, 'pause': KeyCode.from_vk(0x13),
    'print_screen': Key.print_screen,
    'f1': Key.f1, 'f2': Key.f2, 'f3': Key.f3, 'f4': Key.f4,
    'f5': Key.f5, 'f6': Key.f6, 'f7': Key.f7, 'f8': Key.f8,
    'f9': Key.f9, 'f10': Key.f10, 'f11': Key.f11, 'f12': Key.f12,
    'volume_mute': Key.media_volume_mute,
    'volume_down': Key.media_volume_down,
    'volume_up': Key.media_volume_up,
    'play_pause': Key.media_play_pause,
    'prev_track': Key.media_previous,
    'next_track': Key.media_next,
}

def get_system_keyboard_state():
    """获取系统真实的 NumLock/CapsLock/ScrollLock 状态（跨平台）"""
    states = {"num_lock": False, "caps_lock": False, "scroll_lock": False}
    system = platform.system()

    if system == "Windows":
        try:
            import ctypes
            user32 = ctypes.windll.user32
            # VK_NUMLOCK = 0x90, VK_CAPITAL = 0x14, VK_SCROLL = 0x91
            states["num_lock"] = (user32.GetKeyState(0x90) & 1) != 0
            states["caps_lock"] = (user32.GetKeyState(0x14) & 1) != 0
            states["scroll_lock"] = (user32.GetKeyState(0x91) & 1) != 0
        except Exception as e:
            logger.debug(f"获取 Windows 键盘状态失败: {e}")
    elif system == "Linux":
        try:
            # 方法1：使用 xset -q（适用于 X11）
            result = subprocess.run(['xset', '-q'], capture_output=True, text=True, timeout=1)
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if 'Caps Lock' in line:
                        states["caps_lock"] = 'on' in line.split(':')[1].lower()
                    elif 'Num Lock' in line:
                        states["num_lock"] = 'on' in line.split(':')[1].lower()
                    elif 'Scroll Lock' in line:
                        states["scroll_lock"] = 'on' in line.split(':')[1].lower()
        except Exception as e:
            logger.debug(f"获取 Linux 键盘状态失败 (xset): {e}")
    else:
        logger.warning(f"不支持自动获取 {system} 系统的键盘锁状态")
    return states

def update_keyboard_state_from_system():
    """从系统读取最新状态，更新全局变量，返回是否有变化"""
    global keyboard_state
    try:
        new_state = get_system_keyboard_state()
        changed = False
        for k in keyboard_state:
            if keyboard_state[k] != new_state[k]:
                keyboard_state[k] = new_state[k]
                changed = True
        return changed
    except Exception as e:
        logger.error(f"更新键盘状态失败: {e}")
        return False

async def broadcast_state(connections_dict):
    """向所有已连接客户端广播当前键盘状态"""
    state_msg = json.dumps({"type": "state_update", "state": keyboard_state})
    to_remove = []
    for websocket in connections_dict:
        try:
            await websocket.send(state_msg)
        except Exception:
            to_remove.append(websocket)
    for ws in to_remove:
        if ws in connections_dict:
            del connections_dict[ws]
    return len(connections_dict)

async def state_poller(connections_dict, poll_interval=0.5):
    """定期轮询系统真实状态，变化时广播"""
    while True:
        await asyncio.sleep(poll_interval)
        if update_keyboard_state_from_system():
            # 状态发生变化，广播给所有客户端
            if connections_dict:
                await broadcast_state(connections_dict)
                logger.debug(f"状态变化，已广播: {keyboard_state}")

def load_settings():
    default_settings = {
        "listen_host": "0.0.0.0", "port": 8765, "max_connections": 5,
        "secret": "default_key_123", "allow_remote": True
    }
    if os.path.exists("settings.json"):
        with open("settings.json", "r", encoding="utf-8") as f:
            settings = json.load(f)
            for k, v in default_settings.items():
                if k not in settings:
                    settings[k] = v
            return settings
    else:
        with open("settings.json", "w", encoding="utf-8") as f:
            json.dump(default_settings, f, indent=4, ensure_ascii=False)
        logger.info("已创建默认配置文件 settings.json")
        return default_settings

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

class ConnectionManager:
    def __init__(self, max_connections: int):
        self.connections = {}
        self.max_connections = max_connections
        self.counter = 0
    def can_accept(self) -> bool:
        return len(self.connections) < self.max_connections
    def add_connection(self, websocket, client_id: int):
        self.connections[websocket] = {'id': client_id, 'connected_at': datetime.now()}
        logger.info(f"客户端 {client_id} 已连接，当前连接数: {len(self.connections)}")
    def remove_connection(self, websocket):
        if websocket in self.connections:
            client_id = self.connections[websocket]['id']
            del self.connections[websocket]
            logger.info(f"客户端 {client_id} 已断开，当前连接数: {len(self.connections)}")
    def get_next_id(self) -> int:
        self.counter += 1
        return self.counter

def handle_key_event(key_name: str, action: str):
    """处理普通按键事件（不含锁定键切换）"""
    try:
        if action == "press":
            if key_name in SPECIAL_KEYS:
                keyboard.press(SPECIAL_KEYS[key_name])
            else:
                keyboard.press(key_name[0] if len(key_name)==1 else key_name)
        elif action == "release":
            if key_name in SPECIAL_KEYS:
                keyboard.release(SPECIAL_KEYS[key_name])
            else:
                keyboard.release(key_name[0] if len(key_name)==1 else key_name)
        elif action == "click":
            if key_name in SPECIAL_KEYS:
                keyboard.press(SPECIAL_KEYS[key_name])
                keyboard.release(SPECIAL_KEYS[key_name])
            else:
                k = key_name[0] if len(key_name)==1 else key_name
                keyboard.press(k)
                keyboard.release(k)
        return True
    except Exception as e:
        logger.debug(f"键盘操作细节: {e}")
        return True

def handle_mouse_event(event_type: str, **kwargs):
    try:
        if event_type == "move":
            mouse.move(kwargs.get('dx',0), kwargs.get('dy',0))
        elif event_type == "click":
            btn_map = {'left': Button.left, 'right': Button.right, 'middle': Button.middle, 'x1': Button.x1, 'x2': Button.x2}
            button = btn_map.get(kwargs.get('button','left'), Button.left)
            action = kwargs.get('action','click')
            if action == "press":
                mouse.press(button)
            elif action == "release":
                mouse.release(button)
            else:
                mouse.click(button)
        elif event_type == "scroll":
            mouse.scroll(kwargs.get('delta_x',0), kwargs.get('delta_y', kwargs.get('delta',0)))
        return True
    except Exception as e:
        logger.error(f"鼠标操作失败: {e}")
        return False

async def handle_client(websocket, settings: dict, mgr: ConnectionManager):
    if not mgr.can_accept():
        await websocket.close(1008, "服务器连接数已达上限")
        return
    # 认证
    try:
        auth_msg = await asyncio.wait_for(websocket.recv(), timeout=30)
        auth_data = json.loads(auth_msg)
        if auth_data.get('type') != 'auth' or auth_data.get('secret') != settings['secret']:
            await websocket.close(1008, "认证失败：密钥错误")
            return
        client_id = mgr.get_next_id()
        mgr.add_connection(websocket, client_id)
        await websocket.send(json.dumps({"type": "auth_ok", "client_id": client_id}))
        # 发送当前真实键盘状态
        update_keyboard_state_from_system()  # 确保缓存是最新的
        await websocket.send(json.dumps({"type": "state_update", "state": keyboard_state}))
        logger.info(f"客户端 {client_id} 认证成功")
    except Exception as e:
        logger.error(f"认证失败: {e}")
        await websocket.close(1008, "认证失败")
        return
    # 消息循环
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get('type')
                if msg_type == 'ping':
                    await websocket.send(json.dumps({"type": "pong"}))
                elif msg_type == 'key':
                    key = data.get('key')
                    action = data.get('action', 'click')
                    handle_key_event(key, action)
                elif msg_type == 'mouse_move':
                    handle_mouse_event('move', dx=data.get('dx',0), dy=data.get('dy',0))
                elif msg_type == 'mouse_click':
                    handle_mouse_event('click', button=data.get('button','left'), action=data.get('action','click'))
                elif msg_type == 'mouse_scroll':
                    handle_mouse_event('scroll', delta=data.get('delta',0), delta_x=data.get('delta_x',0))
                elif msg_type == 'get_state':
                    update_keyboard_state_from_system()
                    await websocket.send(json.dumps({"type": "state_update", "state": keyboard_state}))
                elif msg_type == 'set_state':
                    # 前端请求修改锁定状态
                    new_state = data.get('state', {})
                    for k in new_state:
                        if k in keyboard_state and new_state[k] != keyboard_state[k]:
                            # 模拟按下对应的锁键，以实际切换系统状态
                            if k == 'num_lock':
                                keyboard.press(Key.num_lock)
                                keyboard.release(Key.num_lock)
                            elif k == 'caps_lock':
                                keyboard.press(Key.caps_lock)
                                keyboard.release(Key.caps_lock)
                            elif k == 'scroll_lock':
                                keyboard.press(Key.scroll_lock)
                                keyboard.release(Key.scroll_lock)
                            logger.info(f"模拟切换锁定键: {k} -> {new_state[k]}")
                    # 等待系统状态稳定，然后读取并广播
                    await asyncio.sleep(0.1)
                    update_keyboard_state_from_system()
                    await broadcast_state(mgr.connections)
            except Exception as e:
                logger.error(f"处理消息错误: {e}")
    except Exception as e:
        logger.info(f"客户端连接关闭: {e}")
    finally:
        mgr.remove_connection(websocket)

async def main():
    settings = load_settings()
    host, port = settings['listen_host'], settings['port']
    local_ip = get_local_ip()
    logger.info("="*50)
    logger.info("在线键盘/鼠标控制系统 - 后端服务")
    logger.info(f"WebSocket 地址: ws://{local_ip}:{port} 或 ws://localhost:{port}")
    logger.info(f"密钥: {settings['secret']}  最大连接数: {settings['max_connections']}")
    logger.info("="*50)

    # 初始同步系统真实键盘状态
    update_keyboard_state_from_system()
    logger.info(f"初始键盘状态: NumLock={keyboard_state['num_lock']}, CapsLock={keyboard_state['caps_lock']}, ScrollLock={keyboard_state['scroll_lock']}")

    mgr = ConnectionManager(settings['max_connections'])
    handler = partial(handle_client, settings=settings, mgr=mgr)

    # 启动状态轮询任务
    async with serve(handler, host, port):
        logger.info(f"服务正在监听 {host}:{port}")
        poller_task = asyncio.create_task(state_poller(mgr.connections))
        await asyncio.Future()  # 运行直到被中断
        poller_task.cancel()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("服务已停止")