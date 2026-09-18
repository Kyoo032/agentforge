# Deploy log

Every hosted deploy appends a row. A deploy that is not in this table did not happen.

This table mirrors the deploy log in the decision record,
[`docs/internal/web-pivot-2026-09-18.md`](../docs/internal/web-pivot-2026-09-18.md).
Write the row in both places; the decision record is the one of record.

`sha` is the full commit sha the image was built from — `scripts/deploy.sh` prints it
and a ready-made row when the healthcheck goes green. Web deploys are not versioned;
`0.14.2x` belongs to desktop maintenance cuts only.

| Date (UTC) | sha | env | who | notes |
|---|---|---|---|---|
| | | | | |
