#!/usr/bin/env bash

set -euo pipefail

repository="${CONTENT_GIT_URL:-https://github.com/BUCT-WIKI/buct-wiki-content.git}"
ref="${CONTENT_GIT_REF:-main}"
content_dir="${CONTENT_DIR:-src/content/docs/content}"

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
content_dir="$(realpath -m "$content_dir")"

if [[ "$content_dir" != "$project_dir/"* ]]; then
	echo "Content directory must be inside the project: $content_dir" >&2
	exit 1
fi

if [[ ! -e "$content_dir" ]]; then
	mkdir -p "$(dirname "$content_dir")"
	echo "Initializing $repository ($ref) in $content_dir"
	git init "$content_dir"
	git -C "$content_dir" remote add origin "$repository"
else
	if [[ "$(git -C "$content_dir" rev-parse --show-toplevel)" != "$content_dir" ]]; then
		echo "Content directory is not a standalone Git checkout: $content_dir" >&2
		exit 1
	fi
	if [[ -n "$(git -C "$content_dir" status --porcelain)" ]]; then
		echo "Content checkout has local changes; refusing to overwrite them." >&2
		exit 1
	fi
	if [[ "$(git -C "$content_dir" remote get-url origin)" != "$repository" ]]; then
		echo "Content checkout belongs to a different repository." >&2
		exit 1
	fi
fi

git -C "$content_dir" fetch --no-tags origin "$ref"
git -C "$content_dir" switch --detach FETCH_HEAD

echo "Content repository is ready."
