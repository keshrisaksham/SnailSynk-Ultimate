# routes/ssl_utils.py
import os
import ssl
import logging
from pathlib import Path

def ensure_ssl_cert(instance_path: str) -> tuple:
    """
    Ensures a self-signed SSL certificate exists in the instance directory.
    Generates one automatically on first run if not found.
    Returns (certfile_path, keyfile_path).
    """
    cert_dir = Path(instance_path)
    cert_dir.mkdir(parents=True, exist_ok=True)
    
    certfile = cert_dir / "cert.pem"
    keyfile = cert_dir / "key.pem"
    
    if certfile.exists() and keyfile.exists():
        logging.info("SSL certificate found. Using existing certificate.")
        return str(certfile), str(keyfile)
    
    logging.info("No SSL certificate found. Generating a new self-signed certificate...")
    
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        
        # Generate RSA private key
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        
        # Build certificate
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SnailSynk"),
            x509.NameAttribute(NameOID.COMMON_NAME, "SnailSynk Local Server"),
        ])
        
        # Subject Alternative Names for localhost + local IPs
        san_list = [
            x509.DNSName("localhost"),
            x509.IPAddress(__import__('ipaddress').IPv4Address("127.0.0.1")),
        ]
        
        # Try to add the machine's local IP
        try:
            from routes.utils import get_local_ip
            local_ip = get_local_ip()
            if local_ip and local_ip != "127.0.0.1":
                san_list.append(x509.IPAddress(__import__('ipaddress').IPv4Address(local_ip)))
        except Exception:
            pass
        
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
            .sign(key, hashes.SHA256())
        )
        
        # Write key file
        with open(keyfile, "wb") as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            ))
        
        # Write cert file
        with open(certfile, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        
        logging.info(f"SSL certificate generated successfully at {cert_dir}")
        return str(certfile), str(keyfile)
        
    except ImportError:
        logging.error(
            "The 'cryptography' package is required for HTTPS. "
            "Install it with: pip install cryptography"
        )
        raise SystemExit(1)
    except Exception as e:
        logging.error(f"Failed to generate SSL certificate: {e}")
        raise
