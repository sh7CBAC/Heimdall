بزودی این بخش راهنما رو آپدیت میکنم.
 الان خسته ام :)


## Quick Start

Run the following command to install or update the panel:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/sh7CBAC/3x-ui-custom/main/install.sh)
```

---

## Hidden Inbound Remarks

This custom version allows you to hide specific inbound entries from the panel by defining their remarks in the x-ui environment configuration file.

To edit the configuration file, run:

```bash
nano /etc/default/x-ui
```

Add or update the following values:

```bash
XUI_HIDDEN_INBOUND_REMARKS=s1,s2,s3,s4,s5,s6
XRAY_VMESS_AEAD_FORCED=false
```

In this example, the inbounds with the following remarks will be hidden:

```text
s1, s2, s3, s4, s5, s6
```

After saving the file, restart the x-ui service:

```bash
systemctl restart x-ui
```

---

## Disable Hidden Inbounds

To disable this feature, set `XUI_HIDDEN_INBOUND_REMARKS` to a value that does not match any real inbound remark.

Example:

```bash
XUI_HIDDEN_INBOUND_REMARKS=disable
XRAY_VMESS_AEAD_FORCED=false
```

Then restart the service:

```bash
systemctl restart x-ui
```
