<img width="2172" height="724" alt="ChatGPT Image Jun 13, 2026, 05_00_19 AM" src="https://github.com/user-attachments/assets/a923de2f-b1d4-4179-97b7-e7b9c829f80e" />


# SECX-Ui

A custom build of **3X-UI** focused on cleaner panel access, hidden internal configurations, and a fast concurrent IP limit system built directly into Xray Core.

> This is an unofficial fork and is not affiliated with the original 3X-UI project.

## What does this version add?

### Core-level IP limit

Starting from `v1.3.0`, client IP limits are handled directly inside Xray Core.

Unlike the usual Fail2ban-based method, this system does not wait for logs to be parsed or an IP to be banned later. Extra IPs are rejected immediately before their traffic reaches an outbound.

For example, with an IP limit of `1`:

```text
First public IP  → Allowed
Same IP again    → Allowed
Second IP        → Rejected
```

The first accepted IP stays connected. New devices cannot replace or disconnect it.

The limit can be set directly when creating or editing a client:

```text
0 = Unlimited
1 = One public IP
2 = Two public IPs
N = Up to N public IPs
```

No Fail2ban, Access Log, firewall ban, or extra setup is required.

### Hidden panel items

This build can hide internal or sensitive parts of the panel, including:

* Inbounds
* Outbounds
* Balancers
* Clients
* Routing rules

Prefix wildcards are also supported:

```text
system-*
```

This can match values such as:

```text
system-client
system-tunnel
system-outbound
```

### Correct client statistics

Hidden clients are also removed from:

* Total client count
* Online client count
* Active client count

So the dashboard statistics match what the panel user can actually see.

### y-ui manager

The custom `y-ui` command makes it easier to manage hidden items without editing environment files manually.

```bash
y-ui
```

You can use it to view, add, or remove hidden inbounds, outbounds, balancers, clients, and other supported items.

## Installation

Install the latest release with:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/sh7CBAC/3x-ui-custom/main/install.sh)
```

Main panel menu:

```bash
x-ui
```

Custom management menu:

```bash
y-ui
```

## Current version

```text
Custom Release: v1.3.0
Panel Base:     3X-UI 3.3.0
Xray Core:      26.6.1 Custom
```

## Release history

### v1.0.0

* Added inbound hiding

### v1.1.0

* Added outbound hiding
* Kept inbound hiding

### v1.2.0

* Added balancer hiding
* Added client hiding
* Added routing rule hiding
* Added wildcard support

### v1.2.1

* Fixed hidden client counts
* Fixed online and active statistics
* Added the `y-ui` management panel

### v1.3.0

* Added concurrent IP limits directly inside Xray Core
* Added First IP Wins behavior
* Removed the need for Fail2ban and Access Log
* Added automatic synchronization between the panel and Xray
* Added automatic IP slot release after inactivity
* Reduced repeated rejection logs

## Important paths

```text
Panel:          /usr/local/x-ui/x-ui
Xray:           /usr/local/x-ui/bin/xray-linux-amd64
Database:       /etc/x-ui/x-ui.db
Environment:    /etc/default/x-ui
IP limit file:  /usr/local/x-ui/bin/client-ip-limits.json
```

## Credits

This project is built on top of:

* [MHSanaei/3x-ui](https://github.com/MHSanaei/3x-ui)
* [XTLS/Xray-core](https://github.com/XTLS/Xray-core)

Thanks to all developers and contributors behind these projects.
