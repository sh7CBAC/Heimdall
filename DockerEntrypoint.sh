#!/bin/sh
set -e

# Heimdall IP and speed limits are enforced inside the custom Xray Core.
# No external banning service or background firewall manager is required.
exec /app/x-ui
