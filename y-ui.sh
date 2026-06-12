#!/usr/bin/env bash

set -u

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
blue='\033[0;34m'
plain='\033[0m'

clear_screen() {
    if [[ -t 1 ]]; then
        printf '\033[2J\033[3J\033[H'
    fi
}

info() {
    echo -e "${green}[INFO]${plain} $*"
}

error() {
    echo -e "${red}[ERROR]${plain} $*" >&2
}

pause_screen() {
    echo
    read -r -p "Press Enter to return..." _
}

if [[ "${EUID}" -ne 0 ]]; then
    error "Run y-ui as root."
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
    local raw item joined
    local -a parts=()
    local -a output=()
    local -A seen=()

    IFS=',' read -r -a parts <<< "${input}"

    for raw in "${parts[@]}"; do
        item="$(trim "${raw}")"
        [[ -z "${item}" ]] && continue

        if [[ -z "${seen["${item}"]+x}" ]]; then
            seen["${item}"]=1
            output+=("${item}")
        fi
    done

    if [[ ${#output[@]} -gt 0 ]]; then
        joined="$(IFS=','; printf '%s' "${output[*]}")"
        printf '%s' "${joined}"
    fi
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
    local raw item joined
    local -a current_parts=()
    local -a remove_parts=()
    local -a output=()
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
        [[ -n "${remove_set["${item}"]+x}" ]] && continue
        [[ -n "${seen["${item}"]+x}" ]] && continue

        seen["${item}"]=1
        output+=("${item}")
    done

    if [[ ${#output[@]} -gt 0 ]]; then
        joined="$(IFS=','; printf '%s' "${output[*]}")"
        printf '%s' "${joined}"
    fi
}

ensure_systemd_environment_file() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi

    install -d -m 755 /etc/systemd/system/x-ui.service.d

    cat > /etc/systemd/system/x-ui.service.d/10-y-ui-env.conf <<ENVEOF
[Service]
EnvironmentFile=-${xui_env_file}
ENVEOF

    systemctl daemon-reload
}

restart_xui() {
    if [[ "${release}" == "alpine" ]] && command -v rc-service >/dev/null 2>&1; then
        if rc-service x-ui restart; then
            info "x-ui restarted successfully."
            return 0
        fi

        error "Failed to restart x-ui."
        return 1
    fi

    if command -v systemctl >/dev/null 2>&1; then
        ensure_systemd_environment_file

        if systemctl restart x-ui; then
            info "x-ui restarted successfully."
            return 0
        fi

        error "Failed to restart x-ui."
        echo
        journalctl -u x-ui -n 30 --no-pager
        return 1
    fi

    error "No supported service manager was found."
    return 1
}

show_hidden_config() {
    clear_screen

    echo -e "${blue}Current Hidden Configuration${plain}"
    echo
    echo "Inbound remarks : $(get_env_value XUI_HIDDEN_INBOUND_REMARKS)"
    echo "Outbound tags   : $(get_env_value XUI_HIDDEN_OUTBOUND_TAGS)"
    echo "Balancer tags   : $(get_env_value XUI_HIDDEN_BALANCER_TAGS)"
    echo "Client emails   : $(get_env_value XUI_HIDDEN_CLIENT_EMAILS)"
    echo
    echo "Environment file: ${xui_env_file}"

    pause_screen
}

apply_hidden_value() {
    local target_key="$1"
    local target_label="$2"
    local new_value="$3"

    set_env_value "${target_key}" "${new_value}"

    clear_screen
    info "${target_label} updated."
    echo
    echo "New value: ${new_value}"
    echo

    restart_xui
    pause_screen
}

configure_hidden_target() {
    local target_key="$1"
    local target_label="$2"
    local current_value action input_value new_value

    while true; do
        current_value="$(get_env_value "${target_key}")"

        clear_screen
        echo -e "${blue}${target_label}${plain}"
        echo
        echo "Current value: ${current_value}"
        echo
        echo "1. Replace the complete list"
        echo "2. Add one or more values"
        echo "3. Remove one or more values"
        echo "4. Clear the list"
        echo "0. Back"
        echo
        read -r -p "Choose an action [0-4]: " action

        case "${action}" in
            1)
                clear_screen
                echo -e "${blue}Replace ${target_label}${plain}"
                echo
                echo "Enter one exact value or multiple comma-separated values."
                echo "Prefix example: system-*"
                echo
                read -r -p "New value: " input_value

                new_value="$(normalize_csv "${input_value}")"
                apply_hidden_value "${target_key}" "${target_label}" "${new_value}"
                ;;
            2)
                clear_screen
                echo -e "${blue}Add to ${target_label}${plain}"
                echo
                echo "Enter one value or multiple comma-separated values."
                echo "Examples: item-1,item-2 or system-*,tunnel-*"
                echo
                read -r -p "Values to add: " input_value

                new_value="$(add_values "${current_value}" "${input_value}")"
                apply_hidden_value "${target_key}" "${target_label}" "${new_value}"
                ;;
            3)
                clear_screen
                echo -e "${blue}Remove from ${target_label}${plain}"
                echo
                echo "Enter the exact configured entries to remove."
                echo
                read -r -p "Values to remove: " input_value

                new_value="$(remove_values "${current_value}" "${input_value}")"
                apply_hidden_value "${target_key}" "${target_label}" "${new_value}"
                ;;
            4)
                clear_screen
                echo -e "${yellow}Clear ${target_label}?${plain}"
                echo
                read -r -p "Type yes to confirm: " input_value

                if [[ "${input_value}" == "yes" ]]; then
                    apply_hidden_value "${target_key}" "${target_label}" ""
                fi
                ;;
            0)
                return 0
                ;;
            *)
                clear_screen
                error "Invalid action."
                pause_screen
                ;;
        esac
    done
}

hidden_items_menu() {
    local choice

    while true; do
        clear_screen
        echo -e "${blue}Hidden Items Management${plain}"
        echo
        echo "1. Manage inbound remarks"
        echo "2. Manage outbound tags"
        echo "3. Manage balancer tags"
        echo "4. Manage client emails"
        echo "5. Show current hidden configuration"
        echo "0. Back to main menu"
        echo
        read -r -p "Choose an option [0-5]: " choice

        case "${choice}" in
            1)
                configure_hidden_target \
                    "XUI_HIDDEN_INBOUND_REMARKS" \
                    "Inbound remarks"
                ;;
            2)
                configure_hidden_target \
                    "XUI_HIDDEN_OUTBOUND_TAGS" \
                    "Outbound tags"
                ;;
            3)
                configure_hidden_target \
                    "XUI_HIDDEN_BALANCER_TAGS" \
                    "Balancer tags"
                ;;
            4)
                configure_hidden_target \
                    "XUI_HIDDEN_CLIENT_EMAILS" \
                    "Client emails"
                ;;
            5)
                show_hidden_config
                ;;
            0)
                return 0
                ;;
            *)
                clear_screen
                error "Invalid option."
                pause_screen
                ;;
        esac
    done
}

main_menu() {
    local choice

    while true; do
        clear_screen
        echo -e "${blue}Y-UI Management Script${plain}"
        echo
        echo "1. Hidden items management"
        echo "0. Exit"
        echo
        read -r -p "Choose an option [0-1]: " choice

        case "${choice}" in
            1)
                hidden_items_menu
                ;;
            0)
                clear_screen
                exit 0
                ;;
            *)
                clear_screen
                error "Invalid option."
                pause_screen
                ;;
        esac
    done
}

main_menu
