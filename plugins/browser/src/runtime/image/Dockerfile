FROM python:3.12.8-slim-bookworm@sha256:2199a62885a12290dc9c5be3ca0681d367576ab7bf037da120e564723292a2f0

ARG BROWSER_USE_VERSION=0.13.8
ARG BROWSER_USE_WHEEL_SHA256=9ea4db1b79504f028b01eec49d15cd4674929395010023f09baca45b5dacb2df
ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium xvfb x11vnc novnc websockify tini ca-certificates curl iproute2 procps util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 2000 boring-browser \
 && useradd --uid 2000 --gid 2000 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin boring-browser \
 && groupadd --gid 1000 boring-agent \
 && useradd --uid 1000 --gid 1000 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin boring-agent
RUN python -m pip download --no-deps "browser-use==${BROWSER_USE_VERSION}" --dest /tmp/wheel \
 && echo "${BROWSER_USE_WHEEL_SHA256}  /tmp/wheel/browser_use-${BROWSER_USE_VERSION}-py3-none-any.whl" | sha256sum -c - \
 && python -m pip install --no-cache-dir "/tmp/wheel/browser_use-${BROWSER_USE_VERSION}-py3-none-any.whl" \
 && rm -rf /tmp/wheel

COPY service.py /opt/boring-browser/service.py
COPY entrypoint.sh /opt/boring-browser/entrypoint.sh
RUN chmod 0555 /opt/boring-browser/service.py /opt/boring-browser/entrypoint.sh

# Viewer ports are declared for the Host-side private projection mechanism only.
# The service container MUST run with --network=none or in a Host-only private
# network namespace and MUST NOT publish these ports to the Agent namespace.
EXPOSE 6081 6082
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/boring-browser/entrypoint.sh"]
