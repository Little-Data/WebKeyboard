# WebKeyboard
使用WebKeyboard远程控制你的电脑，应急临时键盘

Use WebKeyboard to remotely control your computer, an emergency temporary keyboard

# 使用

使用前请在要操控的电脑上安装 Python，并安装以下依赖

```Python
pip install websockets pynput
```

之后启动后端文件 `server.py`

配合前端，将 ws 链接与密钥填入，连接成功后即可操控。

建议访问前端页面的设备有足够大的屏幕以获得最佳效果。

一些配置可以修改 `settings.json` 文件

```json
{
    "listen_host": "0.0.0.0",  /*监听地址*/
    "port": 8765,              /*监听端口*/
    "max_connections": 5,      /*最大设备连接数*/
    "secret": "123",           /*密钥*/
    "allow_remote": true       /*是否允许局域网访问*/
}
```