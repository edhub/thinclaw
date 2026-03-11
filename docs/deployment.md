# Deployment

ThinClaw produces a directory of static files (`build/`). Serve it with any static file host.

The only requirement: configure a fallback to `index.html` for all paths (SPA routing).

---

## nginx

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/thinclaw;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache immutable hashed assets forever
    location /_app/immutable/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

With HTTPS (Certbot / Let's Encrypt):

```bash
sudo certbot --nginx -d example.com
```

---

## Caddy

```
example.com {
    root * /var/www/thinclaw
    encode gzip
    try_files {path} /index.html
    file_server
}
```

---

## Cloudflare Pages

1. Connect your repo in the Cloudflare Pages dashboard
2. Build command: `pnpm build`
3. Output directory: `build`
4. No environment variables needed

Cloudflare Pages handles the SPA fallback automatically.

---

## GitHub Pages

GitHub Pages does not natively support SPA fallback. Workaround:

```bash
# After build, copy index.html to 404.html
cp build/index.html build/404.html
```

GitHub Pages serves `404.html` for unknown paths, which acts as the SPA fallback.

Add this to your build script or CI pipeline.

---

## Docker

```dockerfile
FROM nginx:alpine
COPY build/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`deploy/nginx.conf`:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /_app/immutable/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Build and run:

```bash
pnpm build
docker build -t thinclaw .
docker run -p 8080:80 thinclaw
```

---

## Build Output

```
build/
├── index.html          # SPA entry point (also used as 404 fallback)
├── favicon.png
└── _app/
    └── immutable/      # Hashed JS + CSS chunks (safe to cache forever)
```

Total size: ~1.5 MB uncompressed, ~450 KB gzipped (including lazy highlight.js chunk).

---

## Environment Variables

ThinClaw has no build-time environment variables. All configuration is done at runtime
in the browser (Settings panel). There is no `.env` file to configure.
