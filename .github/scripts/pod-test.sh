#!/bin/bash
# Full acceptance of the extension inside a gnome-shell-pod container:
#   .github/scripts/pod-test.sh <pod-tag> <container-name>
#
# <pod-tag> is the image suffix (e.g. 39, 41, rawhide); the image is
# ghcr.io/schneegans/gnome-shell-pod-<pod-tag>. The caller builds the zip
# first (notes@escator.zip at the repository root) and runs this script from
# the repository root. Works both rootless (local podman) and under sudo
# (GitHub Actions).
#
# Steps: pull image, boot the session, install + enable the zip, restart the
# session, require state ENABLED/ACTIVE, require a clean journal, run the
# three gjs suites under the container's gjs. The container is removed on
# success and kept (named after <container-name>) on failure.
set -euo pipefail

POD_TAG="$1"
NAME="$2"
UUID=notes@escator
IMAGE="ghcr.io/schneegans/gnome-shell-pod-$POD_TAG"

echo "::group::podman: $IMAGE"
podman pull -q "$IMAGE"
podman rm -f "$NAME" >/dev/null 2>&1 || true
# the images' default command is /usr/sbin/init: a full system boot; the
# tty is REQUIRED — the autologin of the image is console-getty on
# /dev/console, which is skipped without an allocated tty (no session then)
podman run -dt --name "$NAME" \
	--cap-add SYS_NICE --cap-add IPC_LOCK --cap-add CAP_SYS_ADMIN \
	"$IMAGE"
echo "::endgroup::"

echo "::group::waiting for the user session"
bus_ok=0
for attempt in 1 2 3; do
	for i in $(seq 1 30); do
		state=$(podman exec --user gnomeshell -e XDG_RUNTIME_DIR=/run/user/1000 \
			"$NAME" systemctl --user is-system-running 2>/dev/null || true)
		if [ "$state" = "running" ] || [ "$state" = "degraded" ]; then
			bus_ok=1
			break
		fi
		sleep 2
	done
	if [ "$bus_ok" = 1 ]; then break; fi
	echo "user session did not come up (attempt $attempt), restarting the autologin getty"
	podman exec "$NAME" systemctl restart getty@tty1 || true
	sleep 10
done
if [ "$bus_ok" != 1 ]; then
	echo "FAIL: the user session never came up"
	podman logs "$NAME" 2>&1 | tail -100 || true
	exit 1
fi
echo "::endgroup::"

# all session-facing commands go through the shell's environment
userexec() {
	podman exec --user gnomeshell --workdir /home/gnomeshell \
		-e XDG_RUNTIME_DIR=/run/user/1000 "$NAME" "$@"
}

echo "::group::install and enable"
# the port's metadata declares 45+ only at release (task 008 F4); version
# validation is switched off for these pre-release runs
userexec systemctl --user reset-failed 'dbus*' 2>/dev/null || true
userexec gsettings set org.gnome.shell disable-extension-version-validation true
podman cp "notes@escator.zip" "$NAME:/tmp/notes@escator.zip"
userexec gnome-extensions install --force /tmp/notes@escator.zip
userexec gnome-extensions enable "$UUID"
echo "::endgroup::"

echo "::group::session restart"
userexec systemctl --user stop gnome-xsession@:99
sleep 2
userexec systemctl --user start gnome-xsession@:99
sleep 12
echo "::endgroup::"

echo "::group::extension state"
userexec gnome-extensions info "$UUID"
state=$(userexec gnome-extensions info "$UUID" | awk '/State:/{print $2}')
case "$state" in
	ENABLED|ACTIVE) echo "state: $state" ;;
	*)
		echo "FAIL: extension state is $state"
		podman logs "$NAME" 2>&1 | tail -100 || true
		exit 1
		;;
esac
echo "::endgroup::"

echo "::group::journal"
if userexec journalctl --user --since '-3 min ago' --no-pager 2>/dev/null \
		| grep -iE "$UUID|JS ERROR|Extension Error" \
		| grep -v 'GNOME Shell started'; then
	echo "FAIL: the journal mentions the extension or JS errors"
	exit 1
else
	echo "journal clean"
fi
echo "::endgroup::"

echo "::group::gjs test suites under gjs $(userexec gjs --version)"
podman exec "$NAME" mkdir -p /home/gnomeshell/smoketree/test
podman exec "$NAME" mkdir -p "/home/gnomeshell/smoketree/notes@escator"
podman cp test/. "$NAME:/home/gnomeshell/smoketree/test/"
podman cp "notes@escator/." "$NAME:/home/gnomeshell/smoketree/notes@escator/"
podman exec "$NAME" chown -R gnomeshell:gnomeshell /home/gnomeshell/smoketree
for suite in test/testLayouts.js test/testTextHistory.js test/smokeExtension.js; do
	echo "--- $suite"
	podman exec --user gnomeshell --workdir /home/gnomeshell/smoketree \
		"$NAME" gjs -m "$suite" | tail -1
done
echo "::endgroup::"

podman rm -f "$NAME" >/dev/null
echo "pod-test $POD_TAG: OK"
