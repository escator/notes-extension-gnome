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
#
# Failure paths print "::error::" workflow annotations with context — those
# stay readable through the public checks API even without repository
# authentication.
set -euo pipefail

POD_TAG="$1"
NAME="$2"
UUID=notes@escator
IMAGE="ghcr.io/schneegans/gnome-shell-pod-$POD_TAG"

trap 'echo "::error::pod-test.sh: unexpected failure at line $LINENO: $BASH_COMMAND"' ERR

fail() { # fail <context>
	echo "::error::$1"
	exit 1
}

echo "::group::podman: $IMAGE"
pulled=0
for attempt in 1 2 3; do
	if pull_out=$(podman pull -q "$IMAGE" 2>&1); then
		pulled=1
		break
	fi
	echo "podman pull failed (attempt $attempt): $pull_out"
	sleep 15
done
[ "$pulled" = 1 ] || fail "podman pull $IMAGE failed after 3 attempts: $(echo "$pull_out" | tail -2)"
podman rm -f "$NAME" >/dev/null 2>&1 || true
# the images' default command is /usr/sbin/init with the kernel arg
# systemd.unified_cgroup_hierarchy=0 (cgroup v1 inside); the GitHub runner
# hosts are cgroup-v2-only and the newer systemd of the F40+ images dies
# after the autologin there (the F39 systemd 254 tolerates the fallback),
# so the command is overridden to a plain unified (v2) boot. The tty is
# REQUIRED — the autologin of the image is console-getty on /dev/console,
# which is skipped without an allocated tty (no session then).
# seccomp/apparmor unconfined: on modern runner kernels (6.8+) the default
# seccomp profile breaks systemd PID1 — "Failed to fork off sandboxing
# environment for executing generators: Protocol error" (clone3 path) —
# acceptable for a disposable test container from a pinned public image
if ! run_out=$(podman run -dt --name "$NAME" \
	--cap-add SYS_NICE --cap-add IPC_LOCK --cap-add CAP_SYS_ADMIN \
	--security-opt seccomp=unconfined --security-opt apparmor=unconfined \
	"$IMAGE" /usr/sbin/init 2>&1); then
	fail "podman run failed: $(echo "$run_out" | tail -3)"
fi
echo "::endgroup::"

echo "::group::waiting for the user session"
bus_ok=0
state=''
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
	if [ "$attempt" = 1 ]; then
		# the F40+ images: the console autologin dies at PAM on the runner
		# hosts (unix_chkpwd "could not obtain user info"), while F39 logs
		# in fine — so, past the first wait, start the user manager and the
		# session directly, without a logind login: enough for the extension
		# (the shell runs on Xvfb, not on a seat)
		echo "autologin did not bring the session up, starting it manually"
		podman exec "$NAME" systemctl start user-runtime-dir@1000.service || true
		podman exec "$NAME" systemctl start user@1000.service || true
		sleep 5
		podman exec --user gnomeshell -e XDG_RUNTIME_DIR=/run/user/1000 \
			"$NAME" systemctl --user start gnome-xsession@:99 || true
		sleep 12
	else
		echo "user session did not come up (attempt $attempt), restarting the autologin getty"
		podman exec "$NAME" systemctl restart getty@tty1 || true
		sleep 10
	fi
done
if [ "$bus_ok" != 1 ]; then
	# failure-proof: every command here may exit non-zero (systemctl
	# is-active returns 3 for an inactive unit), and set -e must not mask
	# the diagnostics with the ERR trap; focused on the user manager —
	# the generic journal is only console-getty restart spam at this point
	podman exec "$NAME" bash -c \
		'systemctl start user@1000.service 2>&1;
		 systemctl status user@1000.service --no-pager 2>&1 | head -10;
		 journalctl -u user@1000.service -u user-runtime-dir@1000.service --no-pager 2>&1 | tail -12;
		 grep -E "PAMName|ExecStart" /usr/lib/systemd/system/user@.service;
		 getent passwd gnomeshell; exit 0' \
		2>&1 | tr -d '\r' | sed 's/^/::error::diag /' || true
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
userexec gnome-extensions install --force /tmp/notes@escator.zip \
	|| fail "gnome-extensions install failed"
userexec gnome-extensions enable "$UUID" || fail "gnome-extensions enable failed"
echo "::endgroup::"

echo "::group::session restart"
userexec systemctl --user stop gnome-xsession@:99
sleep 2
userexec systemctl --user start gnome-xsession@:99 \
	|| fail "could not start gnome-xsession@:99"
sleep 12
echo "::endgroup::"

echo "::group::extension state"
userexec gnome-extensions info "$UUID"
state=$(userexec gnome-extensions info "$UUID" | awk '/State:/{print $2}')
case "$state" in
	ENABLED|ACTIVE) echo "state: $state" ;;
	*)
		userexec journalctl --user --no-pager 2>/dev/null \
			| tail -12 | sed 's/^/::error::jrnl /' || true
		fail "extension state is $state"
		;;
esac
echo "::endgroup::"

echo "::group::journal"
if userexec journalctl --user --since '-3 min ago' --no-pager 2>/dev/null \
		| grep -iE "$UUID|JS ERROR|Extension Error" \
		| grep -v 'GNOME Shell started'; then
	echo "::error::the journal mentions the extension or JS errors (see the lines above)"
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
	if ! out=$(podman exec --user gnomeshell \
			--workdir /home/gnomeshell/smoketree "$NAME" gjs -m "$suite" 2>&1); then
		fail "$suite failed: $(echo "$out" | tail -4)"
	fi
	echo "$out" | tail -1
done
echo "::endgroup::"

podman rm -f "$NAME" >/dev/null
echo "pod-test $POD_TAG: OK"
