# routes/utils.py
import socket
import platform
import subprocess
import logging

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        ip_address = s.getsockname()[0]
    except Exception:
        ip_address = '127.0.0.1'
    finally:
        s.close()
    return ip_address

def get_current_ssid():
    try:
        system = platform.system()
        if system == 'Windows':
            output = subprocess.check_output("netsh wlan show interfaces", shell=True, stderr=subprocess.DEVNULL, text=True)
            for line in output.split('\n'):
                if "SSID" in line and ":" in line:
                    return line.split(":")[1].strip()
        elif system == 'Darwin':
            output = subprocess.check_output("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I", shell=True, stderr=subprocess.DEVNULL, text=True)
            for line in output.split('\n'):
                if "SSID" in line and ":" in line:
                    return line.split(":")[1].strip()
        elif system == 'Linux':
            output = subprocess.check_output("iwgetid -r", shell=True, stderr=subprocess.DEVNULL, text=True)
            return output.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        logging.warning("Could not determine Wi-Fi SSID.")
        return None
    return None