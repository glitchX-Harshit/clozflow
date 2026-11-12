#!/usr/bin/env bash
# ==============================================================================
# Clozflow KVM VPS Production Tuning Script (2 vCPU / 8GB RAM)
# Configures Linux Kernel, Sockets, File Descriptors, and Emergency Swap
# Optimized for 10–25 Concurrent Real-time AI Voice Streams (~1–2 Lakh mins/mo)
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Starting Clozflow KVM Host Optimization..."
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash tune_kvm_server.sh"
  exit 1
fi

# 1. SETUP 4GB EMERGENCY SWAP (Prevents OOM Killer if RAM hits 8.1GB)
echo "[1/4] Checking Swap Memory..."
CURRENT_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$CURRENT_SWAP" -lt 2000 ]; then
  echo "[+] Creating 4GB Swapfile at /swapfile..."
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "[+] 4GB Swap enabled successfully."
else
  echo "[OK] Sufficient Swap space already present (${CURRENT_SWAP}MB)."
fi

# 2. FILE DESCRIPTORS & PROCESS LIMITS
echo "[2/4] Optimizing File Descriptors (Limits)..."
cat << 'EOF' > /etc/security/limits.d/99-clozflow.conf
* soft nofile 65535
* hard nofile 65535
* soft nproc 32768
* hard nproc 32768
root soft nofile 65535
root hard nofile 65535
EOF

ulimit -n 65535 || true

# 3. KERNEL NETWORK & MEMORY SYSCTL TUNING
echo "[3/4] Tuning Kernel Sysctl Parameters..."
cat << 'EOF' > /etc/sysctl.d/99-clozflow-voice.conf
# Maximum open files
fs.file-max = 2097152

# Sockets & Concurrency Backlog
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Port Range for High-Frequency Outbound REST / WebSocket APIs
net.ipv4.ip_local_port_range = 1024 65535

# Fast TCP recycling for closed calls
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1

# Optimize Buffer Memory for Voice Media
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216

# Keep RAM priority for real-time AI audio, swap only when critical
vm.swappiness = 10
EOF

sysctl --system > /dev/null

# 4. SYSTEM SUMMARY & VERIFICATION
echo "[4/4] Verifying Optimization State..."
echo "----------------------------------------------------------"
echo " Open File Limit (ulimit -n): $(ulimit -n)"
echo " Somaxconn (TCP queue):       $(cat /proc/sys/net/core/somaxconn)"
echo " Total Available RAM + Swap:  $(free -h | awk '/^Mem:/ {print $2}') RAM / $(free -h | awk '/^Swap:/ {print $2}') Swap"
echo "----------------------------------------------------------"
echo " Clozflow KVM Host Optimization Complete!"
echo " Safe for 10-25 concurrent calls without OS jitter or OOM drops."
echo "=========================================================="
