# syntax=docker/dockerfile:1
#
# The hivetty-server base image (HIVE-426). Private; the runner image (HIVE-303) builds FROM it.
#
# The build context is a folder of tarball artifacts, laid out as actions/download-artifact
# writes them: hivetty-server-linux-arm64/ and/or hivetty-server-linux-x64/, each holding one
# hivetty-server-<version>-linux-<arch>.tar.gz and its one-line SHA256SUMS. A single-arch build
# needs only its own folder. The pins come from versions.env, one --build-arg per line.
ARG DEBIAN_DIGEST
FROM debian:bookworm-slim@${DEBIAN_DIGEST}

ARG TARGETARCH
ARG TINI_VERSION
ARG HIVETTY_UID=10001
ARG HIVETTY_GID=10001

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# libatomic1: the tarball's Node links libatomic.so.1, which slim lacks (HIVE-425).
# The tarball is checked against its SHA256SUMS before it is unpacked: a missing folder or a
# wrong checksum fails the build. Root owns /opt/hivetty-server and nobody may write it.
# The home is the volume, private to the server's user.
RUN --mount=type=bind,target=/ctx \
    apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libatomic1 "tini=${TINI_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && arch="${TARGETARCH}" \
    && if [ "$arch" = "amd64" ]; then arch=x64; fi \
    && dir="/ctx/hivetty-server-linux-${arch}" \
    && sed "s#  #  ${dir}/#" "${dir}/SHA256SUMS" | sha256sum -c - \
    && tar -xzf "${dir}"/hivetty-server-*.tar.gz -C /opt --no-same-owner \
    && chmod -R a-w /opt/hivetty-server \
    && groupadd -g "${HIVETTY_GID}" hivetty \
    && useradd -l -u "${HIVETTY_UID}" -g hivetty -M -d /var/lib/hivetty hivetty \
    && install -d -m 0700 -o "${HIVETTY_UID}" -g "${HIVETTY_GID}" /var/lib/hivetty

ENV HIVETTY_HOME=/var/lib/hivetty \
    TMPDIR=/var/lib/hivetty/tmp

VOLUME /var/lib/hivetty

USER ${HIVETTY_UID}:${HIVETTY_GID}

STOPSIGNAL SIGTERM

HEALTHCHECK CMD ["/opt/hivetty-server/bin/hivetty-server", "--health"]

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/hivetty-server/bin/hivetty-server"]
