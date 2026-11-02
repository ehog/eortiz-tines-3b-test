FROM 3b/base

RUN \
  --mount=type=cache,target=uv \
  --mount=type=cache,target=uvx \
  curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/astral-sh/uv/releases/download/0.6.14/uv-$(uname -m)-unknown-linux-gnu.tar.gz" \
    | tar -xzf - --strip-components=1 && \
  chmod +x ./uv ./uvx

RUN \
  --mount=type=cache,target=python \
  curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/astral-sh/python-build-standalone/releases/download/20250409/cpython-3.13.3+20250409-$(uname -m)-unknown-linux-gnu-install_only_stripped.tar.gz" \
    | tar -xzf -

COPY requirements.txt .
RUN \
  --mount=type=cache,target=site-packages \
  if [ -f requirements.txt ]; then \
    LD_LIBRARY_PATH=./python/lib UV_NATIVE_TLS=true \
    ./uv pip install --python ./python/bin/python3 --target site-packages -r requirements.txt; \
  fi

COPY script.py .
CMD LD_LIBRARY_PATH=./python/lib PYTHONPATH=./site-packages \
    ./python/bin/python3 -S script.py
