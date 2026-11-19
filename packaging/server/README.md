# The hivetty-server base image

Internal. HIVE-426.

## What this is

`ghcr.io/behiques/hivetty-server` is the server edition's base image: the Linux
tarball from `.github/workflows/server.yml`, unpacked read-only into
`debian:bookworm-slim` with `tini` as PID 1. It is private, and it is the base
the runner image (`hivetty-runner`, HIVE-303) builds `FROM`. Plain
`hivetty-server` carries no git, no agent CLI and no toolchain; it is for
development and for Enterprise's own use.

What it sets:

| | |
| --- | --- |
| Entrypoint | `/usr/bin/tini -- /opt/hivetty-server/bin/hivetty-server`, no `CMD` |
| `HIVETTY_HOME` | `/var/lib/hivetty`, a `VOLUME` |
| `TMPDIR` | `/var/lib/hivetty/tmp`, created by the server at boot |
| User | `hivetty`, uid and gid 10001 (build args `HIVETTY_UID`, `HIVETTY_GID`); any `--user` works |
| Health | `HEALTHCHECK CMD ["/opt/hivetty-server/bin/hivetty-server", "--health"]` |
| Stop | `STOPSIGNAL SIGTERM` |
| Ports | none exposed; the port is the `server.bind` in `config.json` |

## Build it locally

The build context is a folder of tarball artifacts, laid out the way
`actions/download-artifact` writes them. A single-architecture build needs only
its own folder:

```
ctx/
  hivetty-server-linux-arm64/
    hivetty-server-<version>-linux-arm64.tar.gz
    SHA256SUMS
  hivetty-server-linux-x64/          # only for an amd64 build
    ...
```

The Dockerfile checks `SHA256SUMS` itself: a missing folder or a wrong checksum
fails the build. From a checkout, with `CTX` a folder outside it:

```sh
run=$(gh run list --repo behiques/hivetty --workflow server.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$run" --repo behiques/hivetty -n hivetty-server-linux-arm64 -D "$CTX/hivetty-server-linux-arm64"

args=(); while IFS= read -r pin; do args+=(--build-arg "$pin"); done < <(grep -E '^[A-Z_]+=' packaging/server/versions.env)
docker build -f packaging/server/Dockerfile "${args[@]}" -t hivetty-server:local "$CTX"
```

Lint it the way CI does:

```sh
docker run --rm -i -v "$PWD/packaging/server/.hadolint.yaml:/.config/hadolint.yaml:ro" hadolint/hadolint:v2.12.0 < packaging/server/Dockerfile
```

## Run it against the dev cloud

The home is a volume at `/var/lib/hivetty`, and it must be owned by the uid the
container runs as: under a `--user` that does not own it nothing runs,
`--gen-key` included, because the server creates its folders before anything
else. The image's own volume is owned by 10001, so under any other `--user`
mount a folder that uid owns, as below. The root filesystem can be read-only.

The secret key lives in a file **outside** the home, mounted under
`/run/secrets/` and named by `HIVETTY_SECRET_KEY_FILE`:

```sh
mkdir home keys
docker run --rm --user 0 --entrypoint chown -v "$PWD/home:/h" hivetty-server:local 20001:20001 /h
docker run --rm --read-only --user 20001:20001 -v "$PWD/home:/var/lib/hivetty" hivetty-server:local --gen-key > keys/key
chmod 600 keys/key
docker run --rm --user 0 --entrypoint chown -v "$PWD/keys:/k" hivetty-server:local -R 20001:20001 /k

common=(--read-only --user 20001:20001 -v "$PWD/home:/var/lib/hivetty" -v "$PWD/keys:/run/secrets:ro" -e HIVETTY_SECRET_KEY_FILE=/run/secrets/key)
docker run --rm -it "${common[@]}" hivetty-server:local --pair laptop
docker run --rm -it "${common[@]}" hivetty-server:local --login
docker run -d --name hivetty-server "${common[@]}" --network host hivetty-server:local
```

The first run writes a template `config.json`. It names paths as the container
sees them (`/var/lib/hivetty/...`).
Nothing is exposed: reach the server through the `server.bind` it names, here
with `--network host`. The `Server` workflow's image cases
(`tests/live/server-edition-conformance.test.ts`, `HIVE_SERVER_IMAGE`) run
exactly this, as uid 20001.

## What an operator must know

- **Exit 3** is a lease without `runners.byo`, and **exit 4** is no usable secret
  key. Neither is fixed by a restart: do not restart on them.
- `--health` needs no key. A server waiting for a licence reports healthy.
- A key file inside the home folder is refused: it would sit beside the data it
  protects.
- A key source that is set but unusable refuses to start; it never falls
  through to the other source (`HIVETTY_SECRET_KEY_FILE`, then
  `HIVETTY_SECRET_KEY`).
- A credential sealed with another key reads as signed out and prints one
  warning line.
- Rotating the key means a new key, then `--login` and the integration tokens
  again.
- SIGTERM exits 0 inside 20 s.
- Logs go to stdout and stderr only.

## How it is published

`.github/workflows/release.yml`, on a `v*` tag:

```
create-draft ── desktop ──────────────────────────────┐
server-tarballs (server.yml, release: true) ── server-image ──┼─ publish ── tidy
```

- `server-image` builds both architectures in one buildx run on
  `ubuntu-24.04-arm` (amd64 under QEMU), pushes `:<version>` and nothing else,
  and boots the pushed digest.
- `publish`, only once every job passed, in this order: checks every image is
  private, flips the draft release, then moves `:next` (a prerelease tag such as
  `v1.0.0-rc.13`) or `:latest` (a stable tag) to the pushed digest. A prerelease
  never moves `:latest`.
- The `:<version>` tag is the digest record; `publish` also prints the digest in
  the run summary.
- **The privacy check** asks GHCR for the manifest with no credentials. A
  refusal passes; a 200 means the package is public and fails the run before the
  draft flips. Fix it in the package's settings on GitHub (the
  `hivetty-server` package, Package settings, Change visibility, Private), then
  re-run the failed jobs.
- A failed image or privacy step leaves an unpublished draft that already
  carries the desktop assets (`tidy` keeps any release with `latest-mac.yml`).
  A draft is invisible to the updater; re-run the failed jobs to finish it.
- A dispatch from a branch pushes no image and publishes nothing. `server.yml`
  never pushes.

## How it is pulled

Each consuming AWS account pulls through an ECR pull-through cache rule with
GHCR as its upstream (HIVE-433, HIVE-436). Each rule holds its own GitHub token
with `read:packages` only, in that account's Secrets Manager. The fleet pins by
digest, never by a moving tag (HIVE-434).

## `versions.env`

`KEY=VALUE` lines and `#` comments only; every `KEY=VALUE` line becomes a
`--build-arg`.

- `DEBIAN_DIGEST`: the multi-arch index digest of `debian:bookworm-slim`.
  Refresh with `docker buildx imagetools inspect debian:bookworm-slim` (its
  `Digest:` line).
- `TINI_VERSION`: tini as bookworm ships it inside that base, the same on both
  architectures. Refresh with, for each of `linux/arm64` and `linux/amd64`:

  ```sh
  docker run --rm --platform linux/arm64 debian:bookworm-slim@<digest> sh -c 'apt-get update -qq && apt-cache policy tini'
  ```

  If the two candidates differ only by a build suffix, pin the common prefix
  followed by `*`.

`ca-certificates` and `libatomic1` are not version-pinned on purpose: the base
is pinned by digest and those two float inside bookworm, so their security
updates land on a rebuild (`.hadolint.yaml` ignores DL3008 for that reason).
