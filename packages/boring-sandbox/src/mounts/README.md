# boring-sandbox mounts

This package currently ships one concrete mount path: host-side `rclone mount`
for S3-compatible prefixes with `--vfs-cache-mode full`, then provider-side
binding into the sandbox.

`mountpoint-s3` is deliberately deferred. It is AWS-specific and read-only for
the use cases considered in X1, so it does not justify a mount driver interface,
registry, or write-back abstraction in this slice.
