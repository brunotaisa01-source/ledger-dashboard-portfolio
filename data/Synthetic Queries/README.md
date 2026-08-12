# Synthetic Query Launcher

Status: LOCAL_SYNTHETIC_ONLY. This subpack contains a deterministic browser fixture and no credentials, tokens, cookies, tenant bindings or live data.

## Runtime files

- `index.html`
- `assets/app.js`
- `assets/synthetic-queries-launcher.js`
- `manifest.json`
- `SYNTHETIC_QUERY_RELEASE_MANIFEST.json`
- `README.md`

## Local configuration

`index.html` provides a fallback `window.SYNQ_CONFIG` with a loopback URL and the synthetic list allowlist. A host may provide the same object before loading the application. The runtime fails closed when the URL, allowlist or host document does not match the local contract.

## Run locally

From the Ledger Dashboard pack root:

```powershell
python -m http.server 8762
```

Open `http://127.0.0.1:8762/data/Synthetic%20Queries/index.html`. Synthetic fixture mode must be selected explicitly with `?mode=synthetic` when required by the launcher.

## External boundary

Tenant APIs, workflow import or execution, credentials, permissions and remote readback are not part of this local fixture and remain external RED.

