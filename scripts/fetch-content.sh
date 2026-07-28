#!/usr/bin/env bash

set -euo pipefail

repository="${CONTENT_GIT_URL:-https://github.com/BUCT-WIKI/buct-wiki-content.git}"
ref="${CONTENT_GIT_REF:-main}"
content_dir="${CONTENT_DIR:-src/content/docs/content}"

if [[ -z "$content_dir" || "$content_dir" == "/" || "$content_dir" == "." ]]; then
	echo "Refusing to replace unsafe content directory: $content_dir" >&2
	exit 1
fi

content_parent="$(dirname "$content_dir")"
mkdir -p "$content_parent"
temporary_dir="$(mktemp -d "$content_parent/.content-clone.XXXXXX")"

cleanup() {
	if [[ -n "${temporary_dir:-}" && -d "$temporary_dir" ]]; then
		rm -rf -- "$temporary_dir"
	fi
}
trap cleanup EXIT

echo "Cloning $repository ($ref) into $content_dir"
git clone \
	--branch "$ref" \
	--single-branch \
	"$repository" \
	"$temporary_dir"

rm -rf -- "$content_dir"
mv "$temporary_dir" "$content_dir"
temporary_dir=""

echo "Content repository is ready."
