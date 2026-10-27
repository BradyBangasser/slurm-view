#!/bin/bash
# Start munge, the controller and one slurmd per node, then run the given
# command (default: follow the controller log).
set -euo pipefail

if [[ ! -s /etc/munge/munge.key ]]; then
  dd if=/dev/urandom bs=1 count=1024 of=/etc/munge/munge.key status=none
fi
chown -R munge:munge /etc/munge /run/munge /var/lib/munge /var/log/munge 2>/dev/null || true
chmod 0400 /etc/munge/munge.key
runuser -u munge -- munged

slurmctld
for node in c1 c2 c3 c4; do slurmd -N "$node"; done

for _ in $(seq 30); do
  if [[ "$(sinfo -h -o '%T' 2>/dev/null | grep -cv -E 'down|unknown|not_responding')" -gt 0 ]]; then
    break
  fi
  sleep 1
done
sinfo

if [[ $# -gt 0 ]]; then
  exec "$@"
fi
exec tail -F /var/log/slurm/slurmctld.log
