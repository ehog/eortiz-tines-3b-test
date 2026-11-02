`GET /kev/api/catalog`: entry point for catalog queries. Forwards `{ kind: "catalog", method, params }` to [Query catalog snapshot](<../Query catalog snapshot/README.md>), which sends the response.

Optional filters (combined with AND): `q`, `cve`, `vendor`, `product`, `ransomware=true|false`, `status=overdue|due_soon|on_track`, `source=kev|watchlist`. Schema in [api.json](api.json).
