`GET /api/screenshot?id=<investigationId>&index=<n>` serves one Proofpoint forensic capture from `<id>/screenshots/`.

The index is zero-padded to three digits and the first matching `.svg`, `.png` or `.jpg` wins, so mock captures (SVG) and real captures (PNG from the Proofpoint forensics API) are both served with the right content type. Mounts the volume read-only.
