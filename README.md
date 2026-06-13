<img width="2172" height="724" alt="ChatGPT Image Jun 13, 2026, 05_00_19 AM" src="https://github.com/user-attachments/assets/a923de2f-b1d4-4179-97b7-e7b9c829f80e" />


# SECX-Ui

A custom build of **3X-UI** made for cleaner panel management, hidden internal configurations, and a fast concurrent IP limit system powered directly by Xray Core.

> SECX-Ui is an unofficial fork and is not affiliated with the original 3X-UI project.

---

## ⚡ Quick Install

Install the latest release with one command:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/sh7CBAC/SECX-Ui/main/install.sh)
```

After installation, open the main management menu with:

```bash
x-ui
```

Open the custom visibility manager with:

```bash
y-ui
```

---

## 🚀 What Does SECX-Ui Add?

### 🔐 Core-Level Concurrent IP Limit

Starting with `v1.3.0`, client IP limits are enforced directly inside **Xray Core**.

Unlike the traditional Fail2ban-based method, SECX-Ui does not wait for access logs to be parsed or for an IP to be banned later. Extra public IPs are rejected immediately before their traffic reaches an outbound.

For a client with an IP limit of `1`:

```text
First public IP  → Allowed
Same public IP   → Allowed
Second public IP → Rejected immediately
```

The first accepted IP stays active. A new device cannot replace or disconnect it.

Available values:

```text
0 = Unlimited
1 = One public IP
2 = Two public IPs
N = Up to N public IPs
```

The limit is configured directly when creating or editing a client in the panel.

No Fail2ban, Access Log, firewall ban, or additional IP-limit setup is required.

#### How It Works

```text
Client authentication
        ↓
Client email and source IP detection
        ↓
Concurrent IP limit check inside Xray Core
        ↓
Traffic allowed or rejected immediately
```

#### Automatic Slot Release

When all connections from an accepted IP are closed, its slot is released after the configured inactivity period.

The default release delay is:

```text
60 seconds
```

#### Protected Logging

Rejected clients may retry many times per second. To prevent unnecessary journal growth, repeated rejection messages are throttled while every extra connection attempt is still rejected.

> Devices behind the same router, Wi-Fi network, or carrier-grade NAT may share one public IP and therefore count as a single IP.

---

### 👁 Hidden Panel Items

SECX-Ui can hide internal or sensitive items from the panel interface:

- Inbounds
- Outbounds
- Balancers
- Clients
- Routing rules

This is useful for internal tunnels, system clients, private routing configurations, and other items that should not be visible to panel users.

---

### ✳️ Wildcard Support

Prefix wildcards are supported for hidden values.

Example:

```text
system-*
```

This can match values such as:

```text
system-client
system-outbound
system-tunnel
system-internal
```

The wildcard must be placed at the end of the value.

---

### 📊 Clean Client Statistics

Hidden clients are also removed from panel statistics:

- Total clients
- Online clients
- Active clients

This keeps the dashboard consistent with the clients that are actually visible in the panel.

---

### 🧰 y-ui Management Tool

SECX-Ui includes the `y-ui` command-line manager for controlling hidden items without manually editing environment files.

Run:

```bash
y-ui
```

The manager can be used to:

- View current hidden values
- Add hidden inbounds
- Add hidden outbounds
- Add hidden balancers
- Add hidden clients
- Remove existing hidden values
- Apply changes and restart the service

The configuration is stored in:

```text
/etc/default/x-ui
```

---

## 🖥 Commands

Main panel management menu:

```bash
x-ui
```

Custom hidden-item manager:

```bash
y-ui
```

Check service status:

```bash
systemctl status x-ui
```

Restart SECX-Ui and Xray:

```bash
systemctl restart x-ui
```

Follow service logs:

```bash
journalctl -u x-ui -f
```

Watch rejected IP-limit attempts:

```bash
journalctl -u x-ui -f | grep --line-buffered '\[IP_LIMIT\]'
```

---

## 📦 Current Version

```text
SECX-Ui Release: v1.3.0
Panel Base:      3X-UI 3.3.0
Xray Core:       26.6.1 Custom
```

---

## 🧬 Release History

### v1.0.0

- Added inbound hiding

### v1.1.0

- Added outbound hiding
- Kept inbound hiding

### v1.2.0

- Added balancer hiding
- Added client hiding
- Added routing rule hiding
- Added wildcard support

### v1.2.1

- Fixed hidden client totals
- Fixed hidden client online statistics
- Fixed hidden client active statistics
- Added the `y-ui` management tool

### v1.3.0

- Added concurrent IP limits directly inside Xray Core
- Added First IP Wins behavior
- Added immediate rejection of additional public IPs
- Removed the need for Fail2ban and Access Log
- Added automatic synchronization between the panel and Xray Core
- Added automatic generation of the IP-limit runtime file
- Added automatic slot release after inactivity
- Added throttling for repeated rejection logs
- Preserved all hiding features from previous releases

---

## 📁 Important Paths

```text
Panel binary:    /usr/local/x-ui/x-ui
Xray binary:     /usr/local/x-ui/bin/xray-linux-amd64
Database:        /etc/x-ui/x-ui.db
Environment:     /etc/default/x-ui
IP-limit file:   /usr/local/x-ui/bin/client-ip-limits.json
Systemd service: /etc/systemd/system/x-ui.service
x-ui command:    /usr/bin/x-ui
y-ui command:    /usr/bin/y-ui
```

The `client-ip-limits.json` file is generated automatically from the panel database and should not normally be edited by hand.

---

## 🙏 Credits

SECX-Ui is built on top of:

- [MHSanaei/3x-ui](https://github.com/MHSanaei/3x-ui)
- [XTLS/Xray-core](https://github.com/XTLS/Xray-core)

Thanks to all developers and contributors behind these projects.

---

## ⚠️ Disclaimer

Use this software at your own risk.

Before installing or upgrading:

- Back up `/etc/x-ui/x-ui.db`
- Test new releases on a separate server when possible
- Keep your SSH connection independent from the proxy being restarted
