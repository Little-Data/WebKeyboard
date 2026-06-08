// DOM 元素
const wsUrlInput = document.getElementById('wsUrl');
const secretInput = document.getElementById('secret');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const modeIndicator = document.getElementById('modeIndicator');
const infoMessage = document.getElementById('infoMessage');
const logContent = document.getElementById('logContent');
const clearLogBtn = document.getElementById('clearLogBtn');
const autoScrollCheckbox = document.getElementById('autoScrollLog');
const mousePad = document.getElementById('mousePad');
const enableMouseMoveCheckbox = document.getElementById('enableMouseMove');
const mousePadElement = document.getElementById('mousePad');
const REPEAT_DELAY = 500;      // 延迟 ms 后开始重复
const REPEAT_INTERVAL = 50;    // 重复间隔 ms

let ws = null;
let isConnected = false;
let clientId = null;
let isMousePressed = false;
let lastMouseX = 0, lastMouseY = 0;
let currentMouseButton = null;
let keyboardState = { num_lock: false, caps_lock: false, scroll_lock: false };
// 鼠标按键长按状态
let mouseHoldState = { left: false, middle: false, right: false };
// 鼠标移动速度因子
let mouseSpeed = 1.0;
let holdLeftCheckbox, holdMiddleCheckbox, holdRightCheckbox;
let mouseSpeedSlider, speedValueSpan;
let keyRepeatTimers = {};      // 存储每个按键的定时器 { key: { timeout, interval } }
let enableKeyboard = true;
let currentSystem = 'win'; 

// 修饰键按住状态（用于组合键）
const modifierHoldState = {
    shift_l: false,
    shift_r: false,
    ctrl_l: false,
    ctrl_r: false,
    alt_l: false,
    alt_r: false,
    win: false
};

// 触摸屏相关变量
let touchStartX = 0, touchStartY = 0;
let touchMoved = false;

// 辅助函数：检测鼠标是否位于 mouse-pad 区域内
function isMouseOverPad(clientX, clientY) {
    if (!mousePadElement) return false;
    const rect = mousePadElement.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right &&
           clientY >= rect.top && clientY <= rect.bottom;
}

// ----- 辅助函数 -----
function addLog(message, type = 'system') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContent.appendChild(logEntry);
    if (autoScrollCheckbox.checked) logContent.scrollTop = logContent.scrollHeight;
    while (logContent.children.length > 300) logContent.removeChild(logContent.firstChild);
}

// 添加浮动退出按钮（在全屏容器内）
function addFullscreenExitButton(fullscreenElement) {
    if (!fullscreenElement) return;
    removeFullscreenExitButton();
    
    const exitBtn = document.createElement('button');
    exitBtn.textContent = '退出全屏';
    exitBtn.className = 'fullscreen-exit-btn';
    exitBtn.onclick = async (e) => {
        e.stopPropagation();
        await document.exitFullscreen();
    };
    document.body.appendChild(exitBtn);
}

// 移除浮动退出按钮
function removeFullscreenExitButton() {
    const existingBtn = document.querySelector('.fullscreen-exit-btn');
    if (existingBtn) existingBtn.remove();
}

// 全屏切换函数
async function toggleFullscreen(element) {
    if (!element) return;
    try {
        if (!document.fullscreenElement) {
            await element.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (err) {
        addLog(`全屏操作失败: ${err.message}`, 'error');
    }
}

// 更新所有全屏按钮的文本状态
function updateFullscreenButtons() {
    const isFull = !!document.fullscreenElement;
    // 更新原始按钮的文字
    document.querySelectorAll('.fullscreen-btn').forEach(btn => {
        const targetSelector = btn.dataset.fullscreenTarget;
        if (!targetSelector) return;
        const targetElem = document.querySelector(targetSelector);
        if (isFull && document.fullscreenElement === targetElem) {
            btn.textContent = '退出全屏';
        } else {
            btn.textContent = '全屏';
        }
    });
    
    // 管理浮动退出按钮
    if (isFull) {
        // 为当前全屏元素添加浮动退出按钮
        addFullscreenExitButton(document.fullscreenElement);
    } else {
        removeFullscreenExitButton();
    }
}

// 根据操作系统返回按键的显示文本
function getSystemDisplay(key, system) {
    if (system === 'mac') {
        if (key === 'Win') return '⌘ Cmd';
        if (key === 'LAlt') return '⌥ Option';
        if (key === 'RAlt') return '⌥ Option';
        if (key === 'Menu') return '⌘';
    } else if (system === 'linux') {
        if (key === 'Win') return 'Super';
        if (key === 'LAlt') return 'Alt';
        if (key === 'RAlt') return 'Alt';
    }
    // 默认返回原本的 keyDisplay 映射或 key 本身
    return keyDisplay[key] || key;
}

function setKeyboardButtonsDisabled(disabled) {
    const allKeyButtons = document.querySelectorAll('.key');
    allKeyButtons.forEach(btn => {
        if (disabled) {
            btn.setAttribute('disabled', 'disabled');
        } else {
            btn.removeAttribute('disabled');
        }
    });
}

// 停止指定按键的长按重复
function stopKeyRepeat(key) {
    if (!key) return;
    if (keyRepeatTimers[key]) {
        if (keyRepeatTimers[key].timeout) clearTimeout(keyRepeatTimers[key].timeout);
        if (keyRepeatTimers[key].interval) clearInterval(keyRepeatTimers[key].interval);
        delete keyRepeatTimers[key];
    }
}

// 开始长按重复（延迟后周期性调用）
function startKeyRepeat(btn, key) {
    if (!enableKeyboard) return;
    if (!key) return;
    // 修饰键、锁定键不开启长按重复，仅执行一次点击行为
    if (isModifierKey(key) || ['NumLk', 'Caps', 'ScrollLock'].includes(key)) {
        handleVirtualKey(key);
        addPressFeedback(btn);
        return;
    }
    
    // 清除已有定时器
    stopKeyRepeat(key);
    
    // 立即执行一次
    handleVirtualKey(key);
    addPressFeedback(btn);
    
    // 延迟后开始周期性重复
    const timeout = setTimeout(() => {
        const interval = setInterval(() => {
            handleVirtualKey(key);
        }, REPEAT_INTERVAL);
        keyRepeatTimers[key].interval = interval;
    }, REPEAT_DELAY);
    
    keyRepeatTimers[key] = { timeout };
}

// 停止所有按键的长按重复（用于断开连接等场景）
function stopAllKeyRepeats() {
    Object.keys(keyRepeatTimers).forEach(key => stopKeyRepeat(key));
}

// 应用鼠标移动速度因子，确保非零移动至少为1像素
function applyMouseSpeed(dx, dy) {
    let newDx = dx * mouseSpeed;
    let newDy = dy * mouseSpeed;
    // 处理整数舍入
    let intDx = Math.round(newDx);
    let intDy = Math.round(newDy);
    // 保证原有方向上有移动量时至少移动1像素
    if (dx !== 0 && intDx === 0) intDx = dx > 0 ? 1 : -1;
    if (dy !== 0 && intDy === 0) intDy = dy > 0 ? 1 : -1;
    return { dx: intDx, dy: intDy };
}

// 发送鼠标按住/释放指令
function sendMouseHold(button, isPress) {
    if (!isConnected) return false;
    const action = isPress ? 'press' : 'release';
    sendToBackend({ type: 'mouse_click', button, action });
    addLog(`鼠标${action === 'press' ? '按住' : '释放'}: ${button}键 (长按锁定)`, 'mouse');
    return true;
}

// 释放所有被锁定的鼠标按键
function releaseAllMouseHolds() {
    for (const [button, isHeld] of Object.entries(mouseHoldState)) {
        if (isHeld) {
            sendMouseHold(button, false);
            mouseHoldState[button] = false;
        }
    }
    // 同步UI复选框
    if (holdLeftCheckbox) holdLeftCheckbox.checked = false;
    if (holdMiddleCheckbox) holdMiddleCheckbox.checked = false;
    if (holdRightCheckbox) holdRightCheckbox.checked = false;
}

// 重置所有鼠标按住状态（可选择性发送释放指令）
function resetMouseHolds(sendRelease = true) {
    if (sendRelease && isConnected) {
        for (const [button, isHeld] of Object.entries(mouseHoldState)) {
            if (isHeld) {
                sendMouseHold(button, false);
            }
        }
    }
    mouseHoldState = { left: false, middle: false, right: false };
    if (holdLeftCheckbox) holdLeftCheckbox.checked = false;
    if (holdMiddleCheckbox) holdMiddleCheckbox.checked = false;
    if (holdRightCheckbox) holdRightCheckbox.checked = false;
}

function clearLog() { logContent.innerHTML = ''; addLog('日志已清空', 'system'); }
clearLogBtn.addEventListener('click', clearLog);

function showInfo(msg, isError = false) {
    infoMessage.textContent = msg;
    infoMessage.style.color = isError ? '#dc3545' : '#28a745';
    setTimeout(() => { if (infoMessage.textContent === msg) infoMessage.textContent = ''; }, 3000);
}

function sendToBackend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        return true;
    }
    return false;
}

function updateConnectionStatus(connected) {
    isConnected = connected;
    const indicator = connectionStatus.querySelector('.status-indicator');
    if (connected) {
        indicator.className = 'status-indicator online';
        statusText.textContent = '已连接';
        modeIndicator.innerHTML = '<span>连接中 - 操作将发送到远程电脑</span>';
        modeIndicator.className = 'mode-indicator online';
        addLog('已连接到服务器', 'system');
        sendToBackend({ type: 'get_state' });
    } else {
        indicator.className = 'status-indicator offline';
        statusText.textContent = '未连接';
        modeIndicator.innerHTML = '<span>未连接 - 请先连接服务器并完成认证</span>';
        modeIndicator.className = 'mode-indicator';
        addLog('已断开连接', 'system');
        // 重置所有修饰键状态
        for (let k in modifierHoldState) {
            if (modifierHoldState[k]) {
                modifierHoldState[k] = false;
                updateModifierButtonStyle(k);
                updateAllKeyLabels()
            }
        }
        currentMouseButton = null;
        isMousePressed = false;
        lastMouseX = lastMouseY = 0;
        releaseAllMouseHolds();
        // 重置速度显示
        if (mouseSpeedSlider) mouseSpeedSlider.value = '1.0';
        if (speedValueSpan) speedValueSpan.textContent = '1.0';
        mouseSpeed = 1.0;
        stopAllKeyRepeats();
        document.querySelectorAll('.key').forEach(btn => btn.classList.remove('pressed'));
    }
}

// ----- 键盘按键规范化 -----
function normalizeKeyNameForBackend(key, shiftPressed = false, capsOn = false) {
    if (!key) return '';
    if (key === 'Print') return 'print_screen';
    if (key === 'Pause') return 'pause';
    // 媒体键映射
    const mediaKeyMap = {
        'VolumeMute': 'volume_mute', 'VolumeDown': 'volume_down', 'VolumeUp': 'volume_up',
        'PrevTrack': 'prev_track', 'PlayPause': 'play_pause', 'NextTrack': 'next_track'
    };
    if (mediaKeyMap[key]) return mediaKeyMap[key];
    
    // 修饰键映射
    if (['LShift','RShift','LCtrl','RCtrl','LAlt','RAlt','Win'].includes(key)) {
        const modMap = { 'LShift':'shift_l','RShift':'shift_r','LCtrl':'ctrl_l','RCtrl':'ctrl_r',
                         'LAlt':'alt_l','RAlt':'alt_r','Win':'win' };
        return modMap[key];
    }
    
    // 特殊功能键映射
    const specialMap = {
        'Esc':'escape','Backspace':'backspace','Tab':'tab','Enter':'enter','Caps':'caps_lock',
        'NumLk':'num_lock','ScrollLock':'scroll_lock','Delete':'delete','Insert':'insert',
        'Home':'home','End':'end','PgUp':'page_up','PgDn':'page_down','Print':'print_screen',
        'Pause':'pause','Menu':'menu','Space':'space',
        '←':'left','↑':'up','↓':'down','→':'right',
        'F1':'f1','F2':'f2','F3':'f3','F4':'f4','F5':'f5','F6':'f6','F7':'f7','F8':'f8','F9':'f9',
        'F10':'f10','F11':'f11','F12':'f12',
        'up': 'up', 'down': 'down', 'left': 'left', 'right': 'right',
        'page_up': 'page_up', 'page_down': 'page_down', 'home': 'home', 'end': 'end',
        'insert': 'insert', 'delete': 'delete'
    };
    if (specialMap[key]) return specialMap[key];
    
    // 普通字符处理
    let char = key;
    if (shiftPressed && shiftMap[char]) {
        char = shiftMap[char];  // 上档字符（如 1 → !）
    } 
    else if (char.length === 1 && /[a-z]/i.test(char)) {
        char = char.toLowerCase();
    }
    return char;
}

function updateAllKeyLabels() {
    const capsOn = keyboardState.caps_lock;
    const shiftPressed = modifierHoldState.shift_l || modifierHoldState.shift_r;
    const numlockOn = keyboardState.num_lock;
    
    document.querySelectorAll('.key').forEach(btn => {
        // 处理数字小键盘的显示
        if (btn.classList.contains('numpad-key')) {
            const key = btn.dataset.key;
            if (!key) return;
            if (!numlockOn && numlockOffMap[key]) {
                const backendKey = numlockOffMap[key];
                btn.textContent = numlockDisplayMap[backendKey] || backendKey;
            } else {
                btn.textContent = keyDisplay[key] || key;
            }
            return;
        }
        
        const key = btn.dataset.key;
        if (!key) return;  // 防御：如果没有 data-key 则跳过
        
        const noChangeKeys = ['NumLk','Caps','ScrollLock','Enter','Backspace','Tab','Esc','Space',
            'Insert','Delete','Home','End','PgUp','PgDn','Print','Pause','Menu',
            'LShift','RShift','LCtrl','RCtrl','LAlt','RAlt','Win',
            '←','↑','↓','→','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
            'VolumeMute','VolumeDown','VolumeUp','PrevTrack','PlayPause','NextTrack'];
        
        if (noChangeKeys.includes(key)) return;
        
        let display = key;
        if (key.length === 1) {
            if (shiftPressed && shiftMap[key]) {
                display = shiftMap[key];
            } else if (/[a-z]/i.test(key)) {
                let isUpperCase = (capsOn && !shiftPressed) || (!capsOn && shiftPressed);
                display = isUpperCase ? key.toUpperCase() : key.toLowerCase();
            }
        }
        btn.textContent = display;
    });
}

// 判断是否是修饰键（用于切换按住状态）
function isModifierKey(key) {
    const modifiers = ['LShift', 'RShift', 'LCtrl', 'RCtrl', 'LAlt', 'RAlt', 'Win'];
    return modifiers.includes(key);
}

// 获取修饰键的后端名称
function getModifierBackendName(key) {
    if (key === 'LShift') return 'shift_l';
    if (key === 'RShift') return 'shift_r';
    if (key === 'LCtrl') return 'ctrl_l';
    if (key === 'RCtrl') return 'ctrl_r';
    if (key === 'LAlt') return 'alt_l';
    if (key === 'RAlt') return 'alt_r';
    if (key === 'Win') return 'win';
    return null;
}

// 更新修饰键按钮的视觉样式
function updateModifierButtonStyle(backendName) {
    const map = {
        'shift_l': 'LShift', 'shift_r': 'RShift',
        'ctrl_l': 'LCtrl', 'ctrl_r': 'RCtrl',
        'alt_l': 'LAlt', 'alt_r': 'RAlt',
        'win': 'Win'
    };
    const frontendKey = map[backendName];
    if (!frontendKey) return;
    // 使用更精确的选择器，包括主键盘和小键盘区域
    const btn = document.querySelector(`.main-key[data-key="${frontendKey}"], .numpad-key[data-key="${frontendKey}"]`);
    if (btn) {
        if (modifierHoldState[backendName]) {
            btn.classList.add('modifier-held');
            console.log(`修饰键 ${frontendKey} 已高亮`);
        } else {
            btn.classList.remove('modifier-held');
            console.log(`修饰键 ${frontendKey} 高亮已移除`);
        }
    } else {
        console.warn(`未找到修饰键按钮: ${frontendKey}`);
    }
}

// 处理修饰键的切换逻辑
function handleModifierKey(key, backendName) {
    if (!enableKeyboard) return false;
    if (!isConnected) {
        showInfo('未连接到服务器，请先连接', true);
        return false;
    }
    const isHeld = modifierHoldState[backendName];
    if (!isHeld) {
        // 按下修饰键
        sendToBackend({ type: 'key', key: backendName, action: 'press' });
        modifierHoldState[backendName] = true;           // 先更新状态
        updateAllKeyLabels();                            // 再刷新键盘显示（此时 Shift 已生效）
        updateModifierButtonStyle(backendName);          // 更新按钮高亮
        addLog(`修饰键按下: ${key} (${backendName}) - 已按住`, 'key');
    } else {
        // 释放修饰键
        sendToBackend({ type: 'key', key: backendName, action: 'release' });
        modifierHoldState[backendName] = false;          // 先更新状态
        updateAllKeyLabels();                            // 再刷新键盘显示（Shift 已取消）
        updateModifierButtonStyle(backendName);          // 取消按钮高亮
        addLog(`修饰键释放: ${key} (${backendName}) - 已松开`, 'key');
    }
    return true;
}

// 释放所有处于按住状态的修饰键
function releaseAllModifiers() {
    let anyReleased = false;
    for (const [backendName, isHeld] of Object.entries(modifierHoldState)) {
        if (isHeld) {
            sendToBackend({ type: 'key', key: backendName, action: 'release' });
            modifierHoldState[backendName] = false;
            updateModifierButtonStyle(backendName);
            anyReleased = true;
        }
    }
    if (anyReleased) {
        updateAllKeyLabels();  // 刷新按键显示
        addLog('已自动释放所有修饰键', 'key');
    }
}

// 处理普通按键（包括媒体键、字母数字等）
function handleNormalKey(key) {
    if (!key) return;
    if (!isConnected) {
        showInfo('未连接到服务器，请先连接', true);
        return;
    }
    const capsOn = keyboardState.caps_lock;
    const shiftPressed = modifierHoldState.shift_l || modifierHoldState.shift_r;
    let normalized = normalizeKeyNameForBackend(key, shiftPressed, capsOn);
    
    // 先发送普通按键（此时修饰键仍处于按下状态，实现正确的组合键效果）
    sendToBackend({ type: 'key', key: normalized, action: 'click' });
    addLog(`发送按键: ${key} -> ${normalized}`, 'key');
}

// ----- 虚拟键盘构建 -----
const mainKeyboardRows = [
    ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Print', 'ScrollLock', 'Pause'],
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
    ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
    ['LShift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'RShift'],
    ['LCtrl', 'Win', 'LAlt', 'Space', 'RAlt', 'Menu', 'RCtrl', '←', '↑', '↓', '→'],
    ['Home', 'Insert', 'PgUp', 'Delete', 'PgDn', 'End']
];
const numpadGridData = [
    { key: 'NumLk', row: 0, col: 0, rowSpan: 1, colSpan: 1, display: 'NumLk' },
    { key: '/', row: 0, col: 1, rowSpan: 1, colSpan: 1, display: '/' },
    { key: '*', row: 0, col: 2, rowSpan: 1, colSpan: 1, display: '*' },
    { key: '-', row: 0, col: 3, rowSpan: 1, colSpan: 1, display: '-' },
    { key: '7', row: 1, col: 0, rowSpan: 1, colSpan: 1, display: '7' },
    { key: '8', row: 1, col: 1, rowSpan: 1, colSpan: 1, display: '8' },
    { key: '9', row: 1, col: 2, rowSpan: 1, colSpan: 1, display: '9' },
    { key: '+', row: 1, col: 3, rowSpan: 2, colSpan: 1, display: '+' },
    { key: '4', row: 2, col: 0, rowSpan: 1, colSpan: 1, display: '4' },
    { key: '5', row: 2, col: 1, rowSpan: 1, colSpan: 1, display: '5' },
    { key: '6', row: 2, col: 2, rowSpan: 1, colSpan: 1, display: '6' },
    { key: '1', row: 3, col: 0, rowSpan: 1, colSpan: 1, display: '1' },
    { key: '2', row: 3, col: 1, rowSpan: 1, colSpan: 1, display: '2' },
    { key: '3', row: 3, col: 2, rowSpan: 1, colSpan: 1, display: '3' },
    { key: 'Enter', row: 3, col: 3, rowSpan: 2, colSpan: 1, display: '⏎' },
    { key: '0', row: 4, col: 0, rowSpan: 1, colSpan: 2, display: '0' },
    { key: '.', row: 4, col: 2, rowSpan: 1, colSpan: 1, display: '.' }
];
const mediaRow = ['VolumeMute', 'VolumeDown', 'VolumeUp', 'PrevTrack', 'PlayPause', 'NextTrack'];
const keyDisplay = {
    'Esc':'Esc','Backspace':'Backspace','Tab':'Tab','Caps':'Caps','Enter':'Enter','LShift':'Shift','RShift':'Shift','LCtrl':'Ctrl','RCtrl':'Ctrl','Win':'Win','LAlt':'Alt','RAlt':'Alt','Menu':'Menu',
    'Space':'␣','Insert':'Ins','Delete':'Del','Home':'Home','End':'End','PgUp':'PgUp','PgDn':'PgDn','Print':'PrtSc','Pause':'Pause','ScrollLock':'Scrlk',
    'NumLk':'NumLk','VolumeMute':'静音','VolumeDown':'VOL-','VolumeUp':'VOL+','PrevTrack':'上一个','PlayPause':'暂停','NextTrack':'下一个',
    '←':'←','↑':'↑','↓':'↓','→':'→'
};

// 上档字符映射表（用于 Shift 组合）
const shiftMap = {
    '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
    '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?'
};

// NumLock 关闭时，小键盘按键映射为功能键
const numlockOffMap = {
    '0': 'insert',
    '1': 'end',
    '2': 'down',
    '3': 'page_down',
    '4': 'left',
    '6': 'right',
    '7': 'home',
    '8': 'up',
    '9': 'page_up',
    '.': 'delete'
};

const numlockDisplayMap = {
    'insert': 'Ins', 'end': 'End', 'down': '↓', 'page_down': 'PgDn',
    'left': '←', 'right': '→', 'home': 'Home', 'up': '↑',
    'page_up': 'PgUp', 'delete': 'Del'
};

function buildKeyboard() {
    const mainContainer = document.getElementById('mainKeyboard');
    const numpadContainer = document.getElementById('numpadKeyboard');
    mainContainer.innerHTML = ''; numpadContainer.innerHTML = '';
    for (const row of mainKeyboardRows) {
        const rowDiv = document.createElement('div'); rowDiv.className = 'key-row';
        for (const key of row) {
            const btn = createKeyButton(key);
            btn.classList.add('main-key');
            rowDiv.appendChild(btn);
        }
        mainContainer.appendChild(rowDiv);
    }
    const mediaRowDiv = document.createElement('div'); mediaRowDiv.className = 'key-row';
    for (const key of mediaRow) {
        const btn = createKeyButton(key);
        btn.classList.add('main-key');
        mediaRowDiv.appendChild(btn);
    }
    mainContainer.appendChild(mediaRowDiv);
    
    const gridContainer = document.createElement('div');
    gridContainer.className = 'numpad-grid';
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
    gridContainer.style.gap = '6px';
    for (const item of numpadGridData) {
        const btn = createKeyButton(item.key);
        btn.classList.add('numpad-key');
        if (item.colSpan === 2) btn.classList.add('colspan2');
        if (item.rowSpan === 2) btn.classList.add('rowspan2');
        btn.style.gridRow = `${item.row + 1} / span ${item.rowSpan}`;
        btn.style.gridColumn = `${item.col + 1} / span ${item.colSpan}`;
        gridContainer.appendChild(btn);
    }
    numpadContainer.appendChild(gridContainer);
    updateAllKeyLabels();
}

// 刷新虚拟键盘（系统切换时调用）
function refreshKeyboard() {
    // 停止所有按键的长按重复
    stopAllKeyRepeats();
    // 保存当前修饰键高亮需要重新应用，暂时不做释放
    const oldModifierState = { ...modifierHoldState };
    // 重建键盘 DOM
    buildKeyboard();
    // 恢复修饰键高亮样式
    for (const [backendName, isHeld] of Object.entries(oldModifierState)) {
        if (isHeld) {
            updateModifierButtonStyle(backendName);
        }
    }
    // 更新锁定键的视觉状态
    updateAllStateKeys();
    // 刷新所有按键的字母大小写（考虑 caps / shift）
    updateAllKeyLabels();
    // 根据当前键盘启用/禁用状态设置按钮禁用
    setKeyboardButtonsDisabled(!enableKeyboard);
}

function createKeyButton(key) {
    const btn = document.createElement('button');
    btn.className = 'key';
    const specialKeys = ['Backspace','Tab','Caps','Enter','LShift','RShift','LCtrl','RCtrl','LAlt','RAlt','Win','Menu','Space','NumLk','ScrollLock'];
    if (specialKeys.includes(key)) btn.classList.add('special');
    if (mediaRow.includes(key)) btn.classList.add('media');
    if (key === 'Space') btn.classList.add('space');
    btn.textContent = getSystemDisplay(key, currentSystem);
    btn.title = key;
    btn.dataset.key = key;
    // ----- 鼠标/触摸 按下处理 -----
    const onPointerDown = (e) => {
        e.preventDefault();
        // 开始长按重复（内部已包含一次立即执行）
        startKeyRepeat(btn, key);
    };
    // ----- 松开处理 -----
    const onPointerUp = (e) => {
        e.preventDefault();
        stopKeyRepeat(key);
        btn.classList.remove('pressed');
    };
    // ----- 鼠标离开按键区域（例如移出按钮）-----
    const onPointerLeave = (e) => {
        stopKeyRepeat(key);
        btn.classList.remove('pressed');
    };
    
    btn.addEventListener('mousedown', onPointerDown);
    btn.addEventListener('mouseup', onPointerUp);
    btn.addEventListener('mouseleave', onPointerLeave);
    
    // 触摸事件（移动端）
    btn.addEventListener('touchstart', onPointerDown, { passive: false });
    btn.addEventListener('touchend', onPointerUp);
    btn.addEventListener('touchcancel', onPointerUp);
    
    // 更新锁定键的视觉状态
    updateKeyState(btn, key);
    
    // 修饰键按住样式初始化
    if (isModifierKey(key)) {
        const backendName = getModifierBackendName(key);
        if (backendName && modifierHoldState[backendName]) {
            btn.classList.add('modifier-held');
        }
    }
    btn.disabled = !enableKeyboard;
    return btn;
}

function addPressFeedback(btn) { 
    btn.classList.add('pressed'); 
}

function handleVirtualKey(key) {
    if (!enableKeyboard) return;
    if (!key) return;
    // 处理锁定键：NumLk, Caps, ScrollLock
    if (key === 'NumLk' || key === 'Caps' || key === 'ScrollLock') {
        if (!isConnected) {
            showInfo('未连接到服务器，请先连接', true);
            return;
        }
        let stateKey = '';
        if (key === 'NumLk') stateKey = 'num_lock';
        else if (key === 'Caps') stateKey = 'caps_lock';
        else if (key === 'ScrollLock') stateKey = 'scroll_lock';
        const newState = !keyboardState[stateKey];
        sendToBackend({ type: 'set_state', state: { [stateKey]: newState } });
        addLog(`切换锁定状态: ${key} -> ${newState ? '开' : '关'}`, 'key');
        return;
    }

    // NumLock 关闭时，将小键盘数字/点映射为功能键
    if (!keyboardState.num_lock && numlockOffMap[key]) {
        key = numlockOffMap[key];
    }

    // 处理修饰键（切换按住/释放）
    if (isModifierKey(key)) {
        const backendName = getModifierBackendName(key);
        if (backendName) {
            handleModifierKey(key, backendName);
        }
        return;
    }
    
    // 普通按键（包括字母、数字、符号、功能键、媒体键等）
    if (!isConnected) {
        showInfo('未连接到服务器，请先连接', true);
        return;
    }
    handleNormalKey(key);
}

function updateKeyState(btn, key) {
    if (!key) return;
    let stateKey = null;
    if (key === 'NumLk') stateKey = 'num_lock';
    else if (key === 'Caps') stateKey = 'caps_lock';
    else if (key === 'ScrollLock') stateKey = 'scroll_lock';
    if (stateKey && keyboardState[stateKey]) btn.classList.add('state-active');
    else if (stateKey) btn.classList.remove('state-active');
}

function updateAllStateKeys() {
    document.querySelectorAll('.key').forEach(btn => {
        const key = btn.dataset.key;
        if (key === 'NumLk' || key === 'Caps' || key === 'ScrollLock') updateKeyState(btn, key);
    });
}

// ----- 鼠标捕获（仅用于触摸板区域）-----
function getMouseButtonName(button) { return {0:'left',2:'right',1:'middle',3:'x1',4:'x2'}[button] || 'left'; }

function onPhysicalMouseDown(event) {
    if (!isConnected) return;
    if (!isMouseOverPad(event.clientX, event.clientY)) return;
    event.preventDefault();
    const btn = getMouseButtonName(event.button);
    currentMouseButton = btn;
    sendToBackend({ type: 'mouse_click', button: btn, action: 'press' });
    addLog(`发送鼠标按下: ${btn}键`, 'mouse');
}

function onPhysicalMouseUp(event) {
    if (!isConnected) return;
    if (!isMouseOverPad(event.clientX, event.clientY)) return;
    event.preventDefault();
    const btn = getMouseButtonName(event.button);
    if (currentMouseButton === btn) currentMouseButton = null;
    sendToBackend({ type: 'mouse_click', button: btn, action: 'release' });
    addLog(`发送鼠标释放: ${btn}键`, 'mouse');
}

let mouseMoveLastX = 0, mouseMoveLastY = 0;
function onPhysicalMouseMove(event) {
    if (!isConnected || !enableMouseMoveCheckbox.checked) return;
    if (!isMouseOverPad(event.clientX, event.clientY)) {
        mouseMoveLastX = 0;
        mouseMoveLastY = 0;
        return;
    }
    if (mouseMoveLastX === 0 && mouseMoveLastY === 0) {
        mouseMoveLastX = event.clientX;
        mouseMoveLastY = event.clientY;
        return;
    }
    let dx = event.clientX - mouseMoveLastX;
    let dy = event.clientY - mouseMoveLastY;
    if (dx === 0 && dy === 0) return;
    // 应用速度因子
    const scaled = applyMouseSpeed(dx, dy);
    dx = scaled.dx;
    dy = scaled.dy;
    if (dx === 0 && dy === 0) return;
    mouseMoveLastX = event.clientX;
    mouseMoveLastY = event.clientY;
    sendToBackend({ type: 'mouse_move', dx, dy });
    addLog(`鼠标移动: (${dx}, ${dy})`, 'mouse');
}

function resetMouseMove() { mouseMoveLastX = 0; mouseMoveLastY = 0; }

// ----- 触摸板 & UI 鼠标控件 -----
function initTouchpad() {
    let padRect = mousePad.getBoundingClientRect(), lastX = 0, lastY = 0, throttleTimer = null;
    window.addEventListener('resize', () => { padRect = mousePad.getBoundingClientRect(); });
    
    function handleMove(clientX, clientY) {
        if (!isConnected || !enableMouseMoveCheckbox.checked) return;
        if (lastX !== 0 && lastY !== 0) {
            let dx = clientX - lastX;
            let dy = clientY - lastY;
            if (dx !== 0 || dy !== 0) {
                const scaled = applyMouseSpeed(dx, dy);
                dx = scaled.dx;
                dy = scaled.dy;
                if (dx !== 0 || dy !== 0) {
                    sendToBackend({ type: 'mouse_move', dx, dy });
                    addLog(`相对移动: (${dx}, ${dy})`, 'mouse');
                }
            }
        }
        lastX = clientX;
        lastY = clientY;
    }
    
    mousePad.addEventListener('mousemove', (e) => {
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => throttleTimer = null, 16);
        handleMove(e.clientX, e.clientY);
        e.preventDefault();
    });
    mousePad.addEventListener('mousedown', (e) => {
        if (e.button === 0 && isConnected) {
            isMousePressed = true;
            sendToBackend({ type: 'mouse_click', button: 'left', action: 'press' });
            addLog(`发送鼠标按下: left键`, 'mouse');
            mousePad.classList.add('active');
        }
        e.preventDefault();
    });
    mousePad.addEventListener('mouseup', (e) => {
        if (e.button === 0 && isMousePressed && isConnected) {
            isMousePressed = false;
            sendToBackend({ type: 'mouse_click', button: 'left', action: 'release' });
            addLog(`发送鼠标释放: left键`, 'mouse');
            mousePad.classList.remove('active');
        }
        e.preventDefault();
    });
    mousePad.addEventListener('mouseleave', () => {
        if (isMousePressed && isConnected) {
            sendToBackend({ type: 'mouse_click', button: 'left', action: 'release' });
            isMousePressed = false;
        }
        mousePad.classList.remove('active');
        lastX = lastY = 0;
    });
    
    // 移动端触摸控制 - 仅移动光标，轻触为单击
    mousePad.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!isConnected) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchMoved = false;
        lastX = touch.clientX;
        lastY = touch.clientY;
    });
    mousePad.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (isConnected && enableMouseMoveCheckbox.checked) {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            if (dx > 5 || dy > 5) touchMoved = true;
            handleMove(touch.clientX, touch.clientY);
        }
    });
    mousePad.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (isConnected && !touchMoved) {
            sendToBackend({ type: 'mouse_click', button: 'left', action: 'click' });
            addLog(`发送鼠标单击: left键 (轻触)`, 'mouse');
        }
        lastX = lastY = 0;
        mousePad.classList.remove('active');
        touchMoved = false;
    });
}

function initMouseButtons() {
    document.querySelectorAll('.mouse-btn').forEach(btn => btn.addEventListener('click', () => {
        if (!isConnected) { showInfo('未连接，请先连接', true); return; }
        const button = btn.dataset.button, action = btn.dataset.action || 'click';
        sendToBackend({ type: 'mouse_click', button, action });
        addLog(`发送鼠标${action}: ${button}键`, 'mouse');
    }));
    document.querySelectorAll('.scroll-btn').forEach(btn => btn.addEventListener('click', () => {
        if (!isConnected) { showInfo('未连接，请先连接', true); return; }
        const delta = parseInt(btn.dataset.delta);
        sendToBackend({ type: 'mouse_scroll', delta });
        addLog(`发送滚轮: ${delta>0?'向上':'向下'}`, 'mouse');
    }));
}

// ----- WebSocket 连接管理 -----
function connectWebSocket() {
    const url = wsUrlInput.value.trim(), secret = secretInput.value.trim();
    if (!url || !secret) { showInfo('请填写完整信息', true); return; }
    // 如果已有连接且处于开启或连接中状态，先断开
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        disconnectWebSocket();
    }
    try {
        ws = new WebSocket(url);
        ws.onopen = () => { addLog('WebSocket 已连接，认证中...', 'system'); ws.send(JSON.stringify({ type: 'auth', secret })); };
        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'auth_ok') {
                    clientId = data.client_id;
                    // 重置所有修饰键状态（防止残留）
                    for (let k in modifierHoldState) {
                        if (modifierHoldState[k]) {
                            modifierHoldState[k] = false;
                            updateModifierButtonStyle(k);
                        }
                    }
                    // 重置鼠标按住状态
                    resetMouseHolds(true);
                    updateAllKeyLabels();
                    updateConnectionStatus(true);
                    showInfo('连接成功');
                } else if (data.type === 'state_update') {
                    keyboardState = data.state;
                    updateAllStateKeys();
                    updateAllKeyLabels();
                    addLog(`键盘状态更新: NumLock=${keyboardState.num_lock}, CapsLock=${keyboardState.caps_lock}, ScrollLock=${keyboardState.scroll_lock}`, 'system');
                } else if (data.type === 'error') {
                    addLog(`服务器错误: ${data.message}`, 'error');
                }
            } catch(err) { addLog(`解析错误: ${err.message}`, 'error'); }
        };
        ws.onerror = () => { showInfo('连接错误', true); updateConnectionStatus(false); };
        ws.onclose = () => { updateConnectionStatus(false); };
    } catch(err) { showInfo(`连接失败: ${err.message}`, true); }
}

function disconnectWebSocket() {
    // 停止所有长按重复
    stopAllKeyRepeats();
    // 释放所有鼠标按住状态
    releaseAllMouseHolds();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
    }
    updateConnectionStatus(false);
}

function saveSettings() { localStorage.setItem('ws_url', wsUrlInput.value); localStorage.setItem('ws_secret', secretInput.value); }

// ----- 初始化 -----
function init() {
    refreshKeyboard();
    initTouchpad();
    initMouseButtons();
    // 物理鼠标/触摸板事件（仅用于鼠标移动/点击，不包含键盘）
    window.addEventListener('mousedown', onPhysicalMouseDown);
    window.addEventListener('mouseup', onPhysicalMouseUp);
    window.addEventListener('mousemove', onPhysicalMouseMove);
    window.addEventListener('mouseleave', resetMouseMove);
    connectBtn.addEventListener('click', connectWebSocket);
    disconnectBtn.addEventListener('click', disconnectWebSocket);
    wsUrlInput.addEventListener('change', saveSettings);
    secretInput.addEventListener('change', saveSettings);
    const savedUrl = localStorage.getItem('ws_url'), savedSecret = localStorage.getItem('ws_secret');
    if (savedUrl) wsUrlInput.value = savedUrl;
    if (savedSecret) secretInput.value = savedSecret;
    addLog('前端已就绪，请连接服务器后进行操作', 'system');

    // 获取鼠标按住复选框元素
    holdLeftCheckbox = document.getElementById('holdLeftBtn');
    holdMiddleCheckbox = document.getElementById('holdMiddleBtn');
    holdRightCheckbox = document.getElementById('holdRightBtn');
    mouseSpeedSlider = document.getElementById('mouseSpeedSlider');
    speedValueSpan = document.getElementById('speedValue');

    // 鼠标按住复选框事件监听
    if (holdLeftCheckbox) {
        holdLeftCheckbox.addEventListener('change', (e) => {
            if (!isConnected) {
                showInfo('未连接，请先连接服务器', true);
                e.target.checked = !e.target.checked;
                return;
            }
            const newState = e.target.checked;
            if (newState !== mouseHoldState.left) {
                sendMouseHold('left', newState);
                mouseHoldState.left = newState;
            }
        });
    }
    if (holdMiddleCheckbox) {
        holdMiddleCheckbox.addEventListener('change', (e) => {
            if (!isConnected) {
                showInfo('未连接，请先连接服务器', true);
                e.target.checked = !e.target.checked;
                return;
            }
            const newState = e.target.checked;
            if (newState !== mouseHoldState.middle) {
                sendMouseHold('middle', newState);
                mouseHoldState.middle = newState;
            }
        });
    }
    if (holdRightCheckbox) {
        holdRightCheckbox.addEventListener('change', (e) => {
            if (!isConnected) {
                showInfo('未连接，请先连接服务器', true);
                e.target.checked = !e.target.checked;
                return;
            }
            const newState = e.target.checked;
            if (newState !== mouseHoldState.right) {
                sendMouseHold('right', newState);
                mouseHoldState.right = newState;
            }
        });
    }

    // 鼠标速度滑块事件
    if (mouseSpeedSlider && speedValueSpan) {
        mouseSpeedSlider.addEventListener('input', (e) => {
            mouseSpeed = parseFloat(e.target.value);
            speedValueSpan.textContent = mouseSpeed.toFixed(2);
            // 保存到本地存储
            localStorage.setItem('mouse_speed', mouseSpeed);
        });
        // 加载保存的速度设置
        const savedSpeed = localStorage.getItem('mouse_speed');
        if (savedSpeed !== null) {
            mouseSpeed = parseFloat(savedSpeed);
            mouseSpeedSlider.value = mouseSpeed;
            speedValueSpan.textContent = mouseSpeed.toFixed(2);
        }
    }

    window.addEventListener('beforeunload', () => {
        stopAllKeyRepeats();
    });

    const enableKeyboardCheckbox = document.getElementById('enableKeyboardControl');
    if (enableKeyboardCheckbox) {
        enableKeyboard = enableKeyboardCheckbox.checked;
        // 初始化所有键盘按钮的禁用状态
        setKeyboardButtonsDisabled(!enableKeyboard);
        
        enableKeyboardCheckbox.addEventListener('change', (e) => {
            enableKeyboard = e.target.checked;
            setKeyboardButtonsDisabled(!enableKeyboard);
            if (!enableKeyboard) {
                // 禁用时停止所有按键的长按重复
                stopAllKeyRepeats();
                // 释放所有被按住的修饰键
                releaseAllModifiers();
                addLog('键盘控制已禁用，虚拟键盘操作已锁定', 'system');
            } else {
                addLog('键盘控制已启用', 'system');
            }
        });
    }

    // 操作系统选择
    const systemSelect = document.getElementById('systemType');
    if (systemSelect) {
        const savedSystem = localStorage.getItem('keyboard_system');
        if (savedSystem && ['win', 'mac', 'linux'].includes(savedSystem)) {
            currentSystem = savedSystem;
            systemSelect.value = currentSystem;
        } else {
            currentSystem = 'win';
            systemSelect.value = 'win';
        }
        systemSelect.addEventListener('change', (e) => {
            currentSystem = e.target.value;
            localStorage.setItem('keyboard_system', currentSystem);
            refreshKeyboard();
            addLog(`操作系统切换为: ${currentSystem === 'win' ? 'Windows' : currentSystem === 'mac' ? 'Mac' : 'Linux'}，按键布局已更新`, 'system');
        });
    }

    // 全屏按钮事件绑定
    document.querySelectorAll('.fullscreen-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetSelector = btn.dataset.fullscreenTarget;
            if (!targetSelector) return;
            const targetElem = document.querySelector(targetSelector);
            if (!targetElem) {
                addLog(`未找到全屏目标: ${targetSelector}`, 'error');
                return;
            }
            toggleFullscreen(targetElem);
        });
    });

    // 监听全屏变化，更新按钮文字
    document.addEventListener('fullscreenchange', updateFullscreenButtons);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtons);
    document.addEventListener('mozfullscreenchange', updateFullscreenButtons);
    document.addEventListener('MSFullscreenChange', updateFullscreenButtons);
    // 初始调用一次，确保按钮状态正确
    updateFullscreenButtons();
}

document.addEventListener('DOMContentLoaded', init);