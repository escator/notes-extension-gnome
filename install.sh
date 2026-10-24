#!/bin/bash

glib-compile-schemas ./notes@escator/schemas

if (( $EUID == 0 )); then
	INSTALL_DIR="/usr/share/gnome-shell/extensions"
else
	INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions"
fi
mkdir -p $INSTALL_DIR

echo "Installing extension files in $INSTALL_DIR/notes@escator"
cp -r notes@escator $INSTALL_DIR

echo "Done."
exit 0

