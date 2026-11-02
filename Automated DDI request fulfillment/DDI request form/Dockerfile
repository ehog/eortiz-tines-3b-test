FROM 3b/base

RUN \
  --mount=type=cache,target=bun \
  case $(uname -m) in \
    x86_64) ARCH=linux-x64; SHA=10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235;; \
    *) ARCH=linux-aarch64; SHA=354c2b049c716aca07b2e5cddb887928ac58950675d1258bb6312083917793b6;; \
  esac && \
  curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-${ARCH}.zip" -o /tmp/bun.zip && \
  unzip -qoj /tmp/bun.zip -d . "bun-${ARCH}/bun" && \
  printf '%s  bun\n' "$SHA" | sha256sum -c - && \
  chmod +x ./bun && \
  ./bun --version >/dev/null

RUN \
  --mount=type=cache,target=tailwindcss \
  case $(uname -m) in x86_64) ARCH=linux-x64;; *) ARCH=linux-arm64;; esac && \
  curl --proto '=https' --tlsv1.2 -fsSL -o ./tailwindcss "https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-${ARCH}" && \
  chmod +x ./tailwindcss

COPY package.json .
RUN \
  --mount=type=cache,target=node_modules \
  if [ -f package.json ]; then ./bun install; fi && \
  mkdir -p node_modules

COPY . .
RUN \
  --mount=type=cache,target=bundle.js \
  --mount=type=cache,target=output.css \
  ./bun build ./mount.tsx --minify --target=browser --define 'process.env.NODE_ENV="production"' --outfile ./bundle.js && \
  ./tailwindcss -i ./globals.css -o ./output.css --minify

CMD ./bun ./render.ts
