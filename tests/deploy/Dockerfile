FROM debian:13
ENV container=docker
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    systemd systemd-sysv dbus ca-certificates curl procps \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
