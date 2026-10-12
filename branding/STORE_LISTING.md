# Detour Proxy — 商店上架文案 / Store Listing Copy

上传 `dist-zip/detour-proxy-<version>.zip` 后，把下面对应字段粘进 Chrome Web Store
Developer Dashboard / Edge Partner Center 即可。中英各一份。

---

## 中文（简体）

### 简介 / Short description（≤132 字符）
将浏览器流量绕道经你局域网内的 v2raya 代理端点转发。支持直连 / 系统 / 固定服务器 / PAC 四种模式与 PAC 国内外分流，最小权限、不收集任何数据。

### 详细描述 / Detailed description
Detour Proxy 是一款基于 Manifest V3 的轻量浏览器代理扩展，把浏览器流量「绕道」经你**已在局域网内部署好的 v2raya 代理端点**转发。它只负责配置、启用、禁用并显示浏览器的代理行为——**不会运行、安装或管理 v2raya 服务本身**。

【功能特性】
• 四种代理模式：直连（Direct）、系统代理（System）、固定服务器（Fixed Servers）、PAC 自动配置。
• 一键开关：主开关掌管开/关；关闭即回直连，且保留你的全部配置。
• 代理端点配置：主机、端口、协议（SOCKS5 / SOCKS4 / HTTP / HTTPS）。
• 绕过列表：指定无需走代理、直连的主机（默认已含 localhost / 127.0.0.1）。
• PAC 支持：远程 URL 或内联脚本两种来源，可实现「国内网站直连、海外流量走代理」的智能分流。
• 状态与错误提示：实时显示当前模式、端点 / PAC 来源，端点不可达时给出明确反馈。
• 跨会话持久化：重启浏览器后自动恢复上次的代理模式。
• 无障碍、响应式、浅/深色主题；Chrome 与 Edge 行为一致。

【使用前提】
你需要**自行在局域网内的某台机器上部署并运行 v2raya**，并记下它暴露的主机、端口与协议。本扩展只负责把浏览器指向该端点。

【隐私】
本扩展**不收集、不上传、不出售任何用户数据**。你的代理配置仅通过浏览器的 chrome.storage 保存在本地。

### 单一用途 / Single purpose
配置浏览器的代理设置，将浏览器流量按用户选择的模式转发到用户在局域网内自建的 v2raya 代理端点。

### 权限理由 / Permission justifications
• proxy：读取并写入浏览器的代理设置，是本扩展按用户配置转发流量的核心能力。
• storage：在本地持久化用户的代理端点、绕过列表与 PAC 配置，使其跨会话保留。
（不申请任何主机权限 host_permissions 或其他权限。）

### 数据用途声明 / Data usage
不收集任何用户数据（No data collected）。不将数据用于与单一用途无关的用途、不出售、不转移。

### 建议分类 / Category
生产力工具（Productivity）或 开发者工具（Developer Tools）。

---

## English

### Short description (≤132 chars)
Route browser traffic through your own LAN v2raya proxy. Direct / System / Fixed / PAC modes with PAC split-routing. Minimal permissions.

### Detailed description
Detour Proxy is a lightweight Manifest V3 browser extension that "detours" your browser traffic through a **v2raya proxy endpoint you already run on your LAN**. It only configures, enables, disables and reports the browser's proxy behavior — it does **not** run, install or manage the v2raya service itself.

Features
• Four proxy modes: Direct, System, Fixed Servers, and PAC auto-config.
• One master switch for on/off; turning it off returns to Direct while keeping all your settings.
• Endpoint config: host, port, protocol (SOCKS5 / SOCKS4 / HTTP / HTTPS).
• Bypass list for hosts that should connect directly (defaults include localhost / 127.0.0.1).
• PAC support via a remote URL or an inline script — enabling smart split-routing.
• Live status and clear errors (e.g. endpoint unreachable).
• Cross-session persistence; restores your last mode on browser restart.
• Accessible, responsive, light/dark theme; identical behavior on Chrome and Edge.

Requirements
You must deploy and run **v2raya yourself on a machine in your LAN**, then point the extension at the host/port/protocol it exposes.

Privacy
This extension collects, transmits and sells **no** user data. Your proxy configuration is stored locally via chrome.storage.

### Single purpose
Configure the browser's proxy settings to forward browser traffic — per the user's chosen mode — to a self-hosted v2raya proxy endpoint on the user's LAN.

### Permission justifications
• proxy: read and write the browser's proxy settings; this is the extension's core capability for routing traffic per the user's configuration.
• storage: persist the user's endpoint, bypass list and PAC configuration locally across sessions.
(No host_permissions or any other permissions are requested.)

### Data usage
No data collected. Not used for unrelated purposes, not sold, not transferred.

### Category
Productivity or Developer Tools.
