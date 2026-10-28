# Backup job image (backlog E0-7, E17-7): pg_dump 16 + age + rclone + busybox crond.
# Built by docker-compose.yml (service "backup"). Build by hand from deploy/:
#   docker build -t mbc-impact/backup backup
FROM postgres:16.15-alpine3.23

RUN apk add --no-cache age rclone curl tzdata

COPY entrypoint.sh backup.sh restore.sh remotes.sh /backup/
RUN chmod 0755 /backup/entrypoint.sh /backup/backup.sh /backup/restore.sh

WORKDIR /backup
# crond needs root; the scripts only touch /tmp and the network.
ENTRYPOINT ["/backup/entrypoint.sh"]
