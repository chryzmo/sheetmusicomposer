# Trusted HTTPS for iPad development

`npm run dev:lan` uses a self-signed certificate by default. For reliable iPad access, generate a certificate with [mkcert](https://github.com/FiloSottile/mkcert), configure Vite to use it, and trust its public CA certificate on your own test iPad.

These steps modify your desktop/iPad trust stores. Do them yourself on devices you control; no installation or trust changes are performed by the app. This is development-only, not a production certificate solution.

## 1. Install mkcert on Fedora

```sh
sudo dnf install mkcert nss-tools
mkcert -install
```

Run `mkcert` as your normal user, not with `sudo`; it may request elevated access when installing its CA. Restart desktop Firefox after installing trust. If your Fedora repositories do not provide mkcert, use its official installation instructions linked above.

## 2. Generate the development certificate

Use the desktop's actual LAN address (currently `192.168.0.249`):

```sh
CERT_DIR="$HOME/.local/share/sheetmusicomposer/certs"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"
mkcert -cert-file "$CERT_DIR/dev.pem" \
  -key-file "$CERT_DIR/dev-key.pem" \
  192.168.0.249 localhost 127.0.0.1 ::1
chmod 600 "$CERT_DIR/dev-key.pem"
```

The private key stays outside the repository and outside the web server root. If the LAN IP changes, regenerate the certificate with the new IP. A router DHCP reservation can keep it stable.

## 3. Configure Vite

From the project root, add these values to `.env.local` (already ignored by Git):

```dotenv
DEV_HTTPS_CERT=/home/cmoore/.local/share/sheetmusicomposer/certs/dev.pem
DEV_HTTPS_KEY=/home/cmoore/.local/share/sheetmusicomposer/certs/dev-key.pem
```

Use your own absolute paths if your home directory differs. Do not use a literal `~` in these values. Preserve any other existing `.env.local` settings. These variables are read only by Vite's configuration, not exposed to the browser.

Stop the existing LAN server with Ctrl+C, then restart it:

```sh
npm run dev:lan
```

When both variables are configured, Vite uses your certificate instead of the self-signed plugin. Missing/unreadable files or an incomplete pair fail startup rather than silently falling back. Ordinary `npm run dev`, builds, and browser tests do not use these certificates.

## 4. Transfer only the public CA certificate to the iPad

Find the CA directory:

```sh
mkcert -CAROOT
```

Transfer **only `rootCA.pem`**, never `rootCA-key.pem` or `dev-key.pem`. A convenient method for Linux is to serve an isolated temporary directory containing just the public certificate:

```sh
PUBLIC_DIR="$(mktemp -d)"
cp "$(mkcert -CAROOT)/rootCA.pem" "$PUBLIC_DIR/dev-root-ca.crt"
python3 -m http.server 5175 --bind 0.0.0.0 --directory "$PUBLIC_DIR"
```

On a trusted LAN, open this in **Safari** on the iPad:

```text
http://192.168.0.249:5175/dev-root-ca.crt
```

This extra server only distributes the public CA certificate. Never serve the mkcert CA directory, your home directory, or the directory containing private keys. Stop it with Ctrl+C after downloading, then remove the temporary directory with `rm -r "$PUBLIC_DIR"` in the same shell. If Python is unavailable, transfer the public certificate through another trusted method. Do not open additional public-internet access for this.

## 5. Install and trust the CA on the iPad

The exact labels can vary slightly by iPadOS version:

1. Allow the profile download in Safari.
2. Open **Settings → Profile Downloaded**, or **Settings → General → VPN & Device Management**.
3. Select the downloaded development CA profile and install it; enter the device passcode if requested.
4. Open **Settings → General → About → Certificate Trust Settings**.
5. Enable **full trust** for that development root CA and confirm.

Trusting a root CA allows certificates signed by its private key to authenticate websites on the device. Keep that key private. Only install a CA you generated/control; remove this development profile when you no longer need it. Managed iPads may prohibit manual CA installation and need administrator assistance or a staging site with public HTTPS.

## 6. Verify

Open in Safari:

```text
https://192.168.0.249:5173/
```

It should load without a certificate warning. Then retry Firefox; close/reopen it if needed. With Safari's remote inspector, `window.isSecureContext` should be `true` and `typeof crypto.randomUUID` should be `"function"`.

Desktop command-line verification, without bypassing TLS validation:

```sh
curl --cacert "$(mkcert -CAROOT)/rootCA.pem" -I https://192.168.0.249:5173/
```

If it fails, check that Vite was restarted, the URL IP is included in the certificate, desktop/iPad dates are correct, and the iPad has both installed the profile and enabled full trust. `curl -k` is not a trust test.

Sources: [mkcert instructions and mobile-device guidance](https://github.com/FiloSottile/mkcert), [Apple certificate trust guidance](https://support.apple.com/en-us/102390).
