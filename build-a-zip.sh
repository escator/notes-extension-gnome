#!/bin/bash

EXT_ID=notes@escator

./update-and-compile-translations.sh --all

cd $EXT_ID

glib-compile-schemas ./schemas

rm -f ../$EXT_ID.zip

zip ../$EXT_ID.zip *.ui
zip ../$EXT_ID.zip *.js
zip ../$EXT_ID.zip *.json
zip ../$EXT_ID.zip *.css

zip -r ../$EXT_ID.zip icons
# EGO builds the schemas for 45+ packages itself: ship the XML, not the binary
zip -r ../$EXT_ID.zip schemas -x schemas/gschemas.compiled
zip -r ../$EXT_ID.zip locale

zip ../$EXT_ID.zip LICENSE

shopt -s globstar

zip -d ../$EXT_ID.zip **/*.pot
zip -d ../$EXT_ID.zip **/*.po

