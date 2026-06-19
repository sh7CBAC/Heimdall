<p align="center">
  <img width="2172" height="724" alt="Heimdall README hero banner" src="https://github.com/user-attachments/assets/c5159c4c-2db1-4248-954c-26739e36ee39" />
</p>

## ⚡ Quick Start

Install Heimdall with one command:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/sh7CBAC/Heimdall/main/install.sh)
```

During installation, Heimdall downloads the latest public release package, installs the panel, configures the service, and guides you through the initial setup.

For most single-server deployments, **SQLite** is the recommended choice. **PostgreSQL** is also available for larger deployments, higher client counts, and more advanced operational environments.

---

## ✨ What Makes Heimdall Different?

Heimdall is an enhanced Xray management panel built for operators who need more control than basic inbound and client management can provide.

It focuses on cleaner subscriptions, smarter routing, practical traffic limits, better infrastructure visibility, and a smoother workflow for real-world deployments.

---

## 🧩 Multi-Profile Inbounds

Heimdall introduces **Multi-Profile Inbounds**, allowing a single inbound to serve multiple independent subscription profiles.

Each profile can have its own domain, host, security settings, display name, and subscription behavior. This removes the need to duplicate inbounds just to create different subscription links or client-facing configurations.

The result is a cleaner backend, more flexible subscription delivery, and a much better workflow for managing multiple domains, user groups, brands, or routing strategies from one organized panel.

---

## 🚦 Upload & Download Speed Limits

Heimdall adds client-level **upload and download speed limits**, giving operators precise control over how much bandwidth each user can consume.

Separate upstream and downstream limits make it easier to create fair usage policies, define different service tiers, and protect server capacity from heavy or abusive usage.

This keeps the network more stable, predictable, and easier to manage — especially when many clients are served from the same infrastructure.

---

## 🔐 Concurrent Connection Limits

Heimdall includes **concurrent connection limits** to help prevent account sharing and keep client usage under control.

Operators can define how many active connections a client is allowed to use at the same time. When the limit is reached, extra connections can be blocked or disconnected to protect server resources and maintain fair access for all users.

This is especially useful for commercial deployments where stable performance, abuse prevention, and predictable resource usage matter.

---

## 📊 Client Activity Monitoring

Heimdall includes optional **Client Activity Monitoring** for operators who need deeper visibility into client traffic behavior.

When enabled, Heimdall can help track observed destinations, traffic usage, and activity patterns for selected clients. This makes it easier to investigate abuse, debug routing issues, review service quality, and understand how traffic is flowing through the system.

The feature is designed to be controlled and operational, giving administrators useful insight without making the panel unnecessarily heavy or complicated.

---

## 🕶️ Hidden Infrastructure

Heimdall includes a dedicated **Hidden Infrastructure** system powered by the `y-ui` script, allowing operators to hide internal resources without affecting runtime behavior.

Inbounds, outbounds, balancers, clients, and even routing rules can be hidden individually, in groups, or by pattern-based matching. This makes it easy to keep tunnel layers, internal routes, backend services, reseller infrastructure, or operational-only entries out of normal panel views and subscription outputs.

Hidden items are only removed from visibility where needed. They continue to work normally in the background, preserving the actual Xray configuration and traffic flow while keeping the panel cleaner, safer, and easier to operate.

---

## 🧭 Smart Subscription Links & Iran Direct Routing

Heimdall brings the customized **Uranus subscription template** into the Sanaei-based panel, making subscription output cleaner, smarter, and more practical for real-world deployments.

With **Smart Iran Direct Routing**, Heimdall can deliver dedicated Xray JSON routing rules for Iranian domains and IP ranges. This allows domestic traffic to be routed directly instead of passing through the proxy path when direct routing is appropriate.

This improves access to local services, reduces unnecessary proxy load, and creates a smoother experience for users who frequently visit Iranian websites, banking platforms, local applications, and domestic resources.

Together, Smart Subscription Links and Iran Direct Routing turn subscriptions into optimized client profiles — not just simple config delivery.


## 🙏 Credits

Heimdall is built on top of the Xray ecosystem and extends the foundation of the excellent [3X-UI](https://github.com/MHSanaei/3x-ui/) project by MHSanaei with additional operational, subscription, routing, and management capabilities.

Heimdall also integrates and customizes ideas from the [Ourenus](https://github.com/MatinDehghanian/Ourenus) subscription template, created by Matin Dehghanian, to provide cleaner and smarter subscription output for real-world deployments.

Special thanks to the open-source projects, developers, and communities that make this ecosystem possible.


## 💛 Support the Project

Heimdall is developed and maintained with a focus on quality, stability, and real-world usability.

If you find this project useful and want to support its continued development, you can make a donation here:

[Donate to Heimdall](https://reymit.ir/heimdall)

Your support helps keep the project moving forward with more energy, better features, and long-term improvements.

