# Stage 2 — apply threshold to Nb_freq, emit fastStar column.
# Cheap operation, isolated from Stage 1 so threshold tweaks don't invalidate
# the expensive neighbour-count cache (R56).
#
# Phase 2 fills in the actual logic. This stub keeps the entrypoint callable
# so the software pack builds.

import sys


def main() -> int:
    print("apply-threshold stub — phase 2 not yet implemented", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
