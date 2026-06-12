#!/usr/bin/env bash

set -u

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
blue='\033[0;34m'
plain='\033[0m'

log_info() {
    echo -e "${green}[INFO]${plain} $*"
}

log_error() {
    echo -e "${red}[ERROR]${plain} $*" >&2
}

if [[ "${EUID}" -ne 0 ]]; then
    log_error "Run this command as root."
    exit 1
fi

if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    release="${ID:-unknown}"
elif [[ -r /usr/lib/os-release ]]; then
    # shellcheck disable=SC1091
    source /usr/lib/os-release
    release="${ID:-unknown}"
else
    release="unknown"
fi

case "${release}" in
    ubuntu | debian | armbian)
        xui_env_file="/etc/default/x-ui"
        ;;
    arch | manjaro | parch | alpine)
        xui_env_file="/etc/conf.d/x-ui"
        ;;
    *)
        xui_env_file="/etc/sysconfig/x-ui"
        ;;
esac

install -d -m 755 "$(dirname "${xui_env_file}")"
touch "${xui_env_file}"
chmod 600 "${xui_env_file}"

trim() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "${value}"
}

normalize_csv() {
    local input="$1"
    local raw item
    local -A seen=()
    local output=()
    local parts=()

    IFS=',' read -r -a parts <<< "${input}"

    for raw in "${parts[@]}"; do
        item="$(trim "${raw}")"
        [[ -z "${item}" ]] && continue

        if [[ -z "${seen[${item}]+x}" ]]; then
            seen["${item}"]=1
            output+=("${item}")
        fi
    done

    local joined=""
    if [[ ${#output[@]} -gt 0 ]]; then
        joined="$(IFS=','; printf '%s' "${output[*]}")"
    fi

    printf '%s' "${joined}"
}

get_env_value() {
    local key="$1"
    awk -v key="${key}" '
        index($0, key "=") == 1 {
            print substr($0, length(key) + 2)
            exit
        }
    ' "${xui_env_file}"
}

set_env_value() {
    local key="$1"
    local value="$2"
    local tmp_file

    tmp_file="$(mktemp)"

    awk -v key="${key}" -v value="${value}" '
        BEGIN {
            written = 0
        }
        index($0, key "=") == 1 {
            if (!written) {
                print key "=" value
                written = 1
            }
            next
        }
        {
            print
        }
        END {
            if (!written) {
                print key "=" value
            }
        }
    ' "${xui_env_file}" > "${tmp_file}"

    cat "${tmp_file}" > "${xui_env_file}"
    rm -f "${tmp_file}"
    chmod 600 "${xui_env_file}"
}

add_values() {
    local current="$1"
    local requested="$2"
    normalize_csv "${current},${requested}"
}

remove_values() {
    local current="$1"
    local requested="$2"
    local raw item
    local current_parts=()
    local remove_parts=()
    local output=()
    local -A remove_set=()
    local -A seen=()

    IFS=',' read -r -a remove_parts <<< "$(normalize_csv "${requested}")"
    for raw in "${remove_parts[@]}"; do
        item="$(trim "${raw}")"
        [[ -n "${item}" ]] && remove_set["${item}"]=1
    done

    IFS=',' read -r -a current_parts <<< "$(normalize_csv "${current}")"
    for raw in "${current_parts[@]}"; do
        item="$(trim "${raw}")"
        [[ -z "${item}" ]] && continue
        [[ -n "${remove_set[${item}]+x}" ]] && continue
        [[ -n "${seen[${item}]+x}" ]] && continue

        seen["${item}"]=1
        output+=("${item}")
    done

    local joined=""
    if [[ ${#output[@]} -gt 0 ]]; then
        joined="$(IFS=','; printf '%s' "${output[*]}")"
    fi

    printf '%s' "${joined}"
}

ensure_systemd_environment_file() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi

    install -d -m 755 /etc/systemd/system/x-ui.service.d

    cat > /etc/systemd/system/x-ui.service.d/10-visibility-env.conf <<EOT
[Service]
EnvironmentFile=-${xui_env_file}
EOT

    systemctl daemon-reload
}

restart_xui() {
    echo

    if [[ "${release}" == "alpine" ]] && command -v rc-service >/dev/null 2>&1; then
        if rc-service x-ui restart; then
            log_info "x-ui restarted successfully."
            return 0
        fi

        log_error "Failed to restart x-ui."
        return 1
    fi

    if command -v systemctl >/dev/null 2>&1; then
        ensure_systemd_environment_file

        if systemctl restart x-ui; then
            log_info "x-ui restarted successfully."
            systemctl --no-pager --full status x-ui | sed -n '1,8p'
            return 0
        fi

        log_error "Failed to restart x-ui."
        journalctl -u x-ui -n 30 --no-pager
        return 1
    fi

    log_error "No supported service manager was found."
    return 1
}

show_current_config() {
    echo
    echo -e "${blue}Current hidden-item configuration:${plain}"
    echo "1. Inbounds : $(get_env_value XUI_HIDDEN_INBOUND_REMARKS)"
    echo "2. Outbounds: $(get_env_value XUI_HIDDEN_OUTBOUND_TAGS)"
    echo "3. Balancers: $(get_env_value XUI_HIDDEN_BALANCER_TAGS)"
    echo "4. Clients  : $(get_env_value XUI_HIDDEN_CLIENT_EMAILS)"
    echo
    echo "Configuration file: ${xui_env_file}"
}

select_target() {
    echo
    echo -e "${blue}What do you want to configure?${plain}"
    echo "1. Inbound remarks"
    echo "2. Outbound tags"
    echo "3. Balancer tags"
    echo "4. Client emails"
    echo "5. Show current configuration"
    echo "0. Exit"
    read -r -p "Choose an option [0-5]: " target_choice

    case "${target_choice}" in
        1)
            target_key="XUI_HIDDEN_INBOUND_REMARKS"
            target_label="Inbound remarks"
            ;;
        2)
            target_key="XUI_HIDDEN_OUTBOUND_TAGS"
            target_label="Outbound tags"
            ;;
        3)
            target_key="XUI_HIDDEN_BALANCER_TAGS"
            target_label="Balancer tags"
            ;;
        4)
            target_key="XUI_HIDDEN_CLIENT_EMAILS"
            target_label="Client emails"
            ;;
        5)
            show_current_config
            return 2
            ;;
        0)
            exit 0
            ;;
        *)
            log_error "Invalid option."
            return 1
            ;;
    esac

    return 0
}

configure_target() {
    local current_value action input_value new_value

    current_value="$(get_env_value "${target_key}")"

    echo
    echo -e "${blue}${target_label}${plain}"
    echo "Current value: ${current_value}"
    echo
    echo "1. Replace the complete list"
    echo "2. Add one or more values"
    echo "3. Remove one or more values"
    echo "4. Clear the list"
    echo "0. Back"
    read -r -p "Choose an action [0-4]: " action

    case "${action}" in
        1)
            echo
            echo "Enter one exact value or multiple comma-separated values."
            echo "Prefix matching example: system-*"
            read -r -p "New value: " input_value
            new_value="$(normalize_csv "${input_value}")"
            ;;
        2)
            echo
            echo "Enter one value or multiple comma-separated values."
            echo "Examples: client-1,client-2 or system-*,tunnel-*"
            read -r -p "Values to add: " input_value
            new_value="$(add_values "${current_value}" "${input_value}")"
            ;;
        3)
            echo
            echo "Enter the exact entries to remove from the configured list."
            read -r -p "Values to remove: " input_value
            new_value="$(remove_values "${current_value}" "${input_value}")"
            ;;
        4)
            new_value=""
            ;;
        0)
            return 0
            ;;
        *)
            log_error "Invalid action."
            return 1
            ;;
    esac

    set_env_value "${target_key}" "${new_value}"

    echo
    log_info "${target_key} updated."
    echo "New value: ${new_value}"

    restart_xui
}

main() {
    while true; do
        select_target
        case "$?" in
            0)
                configure_target
                ;;
            2)
                ;;
            *)
                ;;
        esac

        echo
        read -r -p "Press Enter to continue..." _
    done
}

main
