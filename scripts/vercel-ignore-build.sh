#!/usr/bin/env bash
# Vercel's Ignored Build Step (vercel.json "ignoreCommand"): exit 0 skips the
# deployment, any other exit builds it. Skips preview deployments whose changes
# are docs only (docs/ and Markdown files, which nothing in the build reads).
# Production always builds, and whenever this can't tell what changed, it builds.

[ "$VERCEL_ENV" = "preview" ] || exit 1

# The last commit this branch deployed, or, on a branch's first deployment
# (when Vercel leaves it empty), the point where the branch left main.
base="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$base" ]; then
  repo="https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git"
  git fetch --quiet --depth=100 "$repo" main 2>/dev/null || exit 1
  base=$(git merge-base HEAD FETCH_HEAD 2>/dev/null) || exit 1
fi

if git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude)*.md'; then
  echo "No changes outside docs since $base: skipping this preview deployment."
  exit 0
fi
exit 1
